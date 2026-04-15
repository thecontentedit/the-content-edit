import crypto from 'crypto';
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

function encryptToken(plaintext) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(ciphertext) {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export default async function handler(req, res) {

  // ─── GET ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const raw = await redis.get(`setup:${token}`);
    if (!raw) return res.status(404).json({ error: 'Token inválido o expirado' });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const base = process.env.NEXT_PUBLIC_BASE_URL;

    // Migración legacy: widgetId string → array
    let widgets = data.widgets || [];
    if (!widgets.length && data.widgetId) {
      widgets = [{
        widgetId: data.widgetId,
        name: 'Widget #1',
        notionToken: data.notionToken,
        notionDbId: data.notionDbId,
        createdAt: data.activatedAt || new Date().toISOString(),
      }];
    }

    return res.status(200).json({
      email: data.email,
      plan: data.plan,
      activated: data.activated,
      widgets: widgets.map(w => {
        let maskedToken = null;
        if (w.notionToken) {
          try {
            const plain = decryptToken(w.notionToken);
            maskedToken = plain.slice(0, 8) + '•'.repeat(Math.max(0, plain.length - 8));
          } catch(e) {
            maskedToken = '••••••••••••••••••••••••••••••';
          }
        }
        return {
          widgetId: w.widgetId,
          name: w.name,
          createdAt: w.createdAt,
          embedUrl: `${base}/embed/${w.widgetId}`,
          maskedToken,
          notionDbId: w.notionDbId || null,
        };
      }),
    });
  }

  // ─── POST: crear widget nuevo ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { setupToken, notionToken, notionDbId, widgetName } = req.body;
    if (!setupToken || !notionToken || !notionDbId) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) return res.status(404).json({ error: 'Token inválido o expirado' });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    let valid;
    for (let attempt = 0; attempt < 2; attempt++) {
      valid = await validateNotion(notionToken, notionDbId);
      if (valid.ok || valid.status !== 'network_error') break;
      await new Promise(r => setTimeout(r, 800));
    }
    if (!valid.ok) return res.status(422).json({ error: valid.message });

    let widgets = data.widgets || [];
    if (!widgets.length && data.widgetId) {
      widgets = [{
        widgetId: data.widgetId,
        name: 'Widget #1',
        notionToken: data.notionToken,
        notionDbId: data.notionDbId,
        createdAt: data.activatedAt || new Date().toISOString(),
      }];
    }

    const widgetId = crypto.randomBytes(16).toString('base64url');
    const newWidget = {
      widgetId,
      name: widgetName || `Widget #${widgets.length + 1}`,
      notionToken: encryptToken(notionToken),
      notionDbId,
      createdAt: new Date().toISOString(),
    };
    widgets.push(newWidget);

    const updated = {
      ...data,
      widgets,
      activated: true,
      // legacy compat
      notionToken: newWidget.notionToken,
      notionDbId,
      widgetId,
      activatedAt: data.activatedAt || new Date().toISOString(),
    };

    await redis.set(`setup:${setupToken}`, JSON.stringify(updated));
    await redis.set(`widget:${widgetId}`, setupToken);

    const base = process.env.NEXT_PUBLIC_BASE_URL;
    return res.status(200).json({
      embedUrl: `${base}/embed/${widgetId}`,
      widgetId,
      plan: updated.plan,
      widgetName: newWidget.name,
    });
  }

  // ─── PATCH: renombrar o reconectar ────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { setupToken, widgetId, name, notionToken, notionDbId } = req.body;
    if (!setupToken || !widgetId) return res.status(400).json({ error: 'Faltan campos requeridos' });

    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) return res.status(404).json({ error: 'Token inválido o expirado' });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    let widgets = data.widgets || [];
    const idx = widgets.findIndex(w => w.widgetId === widgetId);
    if (idx === -1) return res.status(404).json({ error: 'Widget no encontrado' });

    if (name) widgets[idx].name = name.trim().slice(0, 60);

    if (notionToken && notionDbId) {
      let valid;
      for (let attempt = 0; attempt < 2; attempt++) {
        valid = await validateNotion(notionToken, notionDbId);
        if (valid.ok || valid.status !== 'network_error') break;
        await new Promise(r => setTimeout(r, 800));
      }
      if (!valid.ok) return res.status(422).json({ error: valid.message });

      widgets[idx].notionToken = encryptToken(notionToken);
      widgets[idx].notionDbId = notionDbId;

      // Si es el widget legacy activo, actualizar campos raíz también
      if (data.widgetId === widgetId) {
        await redis.set(`setup:${setupToken}`, JSON.stringify({
          ...data, widgets,
          notionToken: widgets[idx].notionToken,
          notionDbId,
        }));
        return res.status(200).json({ ok: true });
      }
    }

    await redis.set(`setup:${setupToken}`, JSON.stringify({ ...data, widgets }));
    return res.status(200).json({ ok: true });
  }

  // ─── DELETE: eliminar widget ──────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { setupToken, widgetId } = req.body;
    if (!setupToken || !widgetId) return res.status(400).json({ error: 'Faltan campos requeridos' });

    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) return res.status(404).json({ error: 'Token inválido o expirado' });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const widgets = (data.widgets || []).filter(w => w.widgetId !== widgetId);
    await redis.set(`setup:${setupToken}`, JSON.stringify({ ...data, widgets }));
    await redis.del(`widget:${widgetId}`);

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function validateNotion(token, dbId) {
  try {
    const cleanDbId = dbId.replace(/-/g, '').trim();
    const r = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    if (r.status === 401) return { ok: false, status: 'auth_error', message: 'Token de Notion inválido. Regresa al paso anterior y vuelve a pegarlo.' };
    if (r.status === 403) return { ok: false, status: 'access_error', message: 'La integración no tiene acceso a esta base de datos. Agrégala en ··· → Connections.' };
    if (r.status === 404) return { ok: false, status: 'not_found', message: 'Base de datos no encontrada. Verifica el ID.' };
    if (!r.ok) return { ok: false, status: 'api_error', message: `Error de Notion: ${r.status}` };
    return { ok: true };
  } catch {
    return { ok: false, status: 'network_error', message: 'No se pudo conectar con Notion. Intenta de nuevo.' };
  }
}
