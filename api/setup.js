// api/setup.js
// Maneja el setup flow del usuario:
// GET  /api/setup?token=xxx  → valida el token y devuelve info del usuario
// POST /api/setup             → guarda notionToken + dbId, genera widgetId

import { kv } from '@vercel/kv';
import crypto from 'crypto';

// Cifra el Notion token antes de guardarlo (AES-256-GCM)
function encryptToken(plaintext) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes hex
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

  // ── GET: valida el setup token ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const data = await kv.get(`setup:${token}`);
    if (!data) return res.status(404).json({ error: 'Token inválido o expirado' });

    // Devuelve solo lo necesario (nunca el token de Notion en texto plano)
    return res.status(200).json({
      email: data.email,
      plan: data.plan,
      activated: data.activated,
      widgetUrl: data.widgetId
        ? `${process.env.NEXT_PUBLIC_BASE_URL}/widget/${data.widgetId}`
        : null,
    });
  }

  // ── POST: guarda credenciales de Notion ─────────────────────────────────
  if (req.method === 'POST') {
    const { setupToken, notionToken, notionDbId } = req.body;

    if (!setupToken || !notionToken || !notionDbId) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const data = await kv.get(`setup:${setupToken}`);
    if (!data) return res.status(404).json({ error: 'Token inválido o expirado' });

    // Valida que el Notion token y DB sean correctos antes de guardar
    const valid = await validateNotion(notionToken, notionDbId);
    if (!valid.ok) {
      return res.status(422).json({ error: valid.message });
    }

    // Genera el widgetId único (usado en la URL del embed)
    const widgetId = crypto.randomBytes(16).toString('base64url');

    const updated = {
      ...data,
      notionToken: encryptToken(notionToken),
      notionDbId,
      widgetId,
      activated: true,
      activatedAt: new Date().toISOString(),
    };

    // Guarda las credenciales cifradas
    await kv.set(`setup:${setupToken}`, updated);
    // Índice widgetId → setupToken para que el widget pueda buscar las credenciales
    await kv.set(`widget:${widgetId}`, setupToken);

    const widgetUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/widget/${widgetId}`;
    const embedUrl  = `${process.env.NEXT_PUBLIC_BASE_URL}/embed/${widgetId}`;

    return res.status(200).json({ widgetUrl, embedUrl, widgetId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Valida que el token de Notion pueda acceder a la DB indicada
async function validateNotion(token, dbId) {
  try {
    const cleanDbId = dbId.replace(/-/g, '').trim();
    const r = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (r.status === 401) return { ok: false, message: 'Token de Notion inválido. Verifica que lo copiaste correctamente.' };
    if (r.status === 403) return { ok: false, message: 'La integración no tiene acceso a esta base de datos. Agrégala en ··· → Connections.' };
    if (r.status === 404) return { ok: false, message: 'Base de datos no encontrada. Verifica el ID.' };
    if (!r.ok)            return { ok: false, message: `Error de Notion: ${r.status}` };

    return { ok: true };
  } catch {
    return { ok: false, message: 'No se pudo conectar con Notion. Intenta de nuevo.' };
  }
}
