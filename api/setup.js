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

  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const raw = await redis.get(`setup:${token}`);
    if (!raw) return res.status(404).json({ error: 'Token inválido o expirado' });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return res.status(200).json({
      email: data.email,
      plan: data.plan,
      activated: data.activated,
      widgetUrl: data.widgetId
        ? `${process.env.NEXT_PUBLIC_BASE_URL}/embed/${data.widgetId}`
        : null,
    });
  }

  if (req.method === 'POST') {
    const { setupToken, notionToken, notionDbId } = req.body;

    if (!setupToken || !notionToken || !notionDbId) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) return res.status(404).json({ error: 'Token inválido o expirado' });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const valid = await validateNotion(notionToken, notionDbId);
    if (!valid.ok) {
      return res.status(422).json({ error: valid.message });
    }

    const widgetId = crypto.randomBytes(16).toString('base64url');

    const updated = {
      ...data,
      notionToken: encryptToken(notionToken),
      notionDbId,
      widgetId,
      activated: true,
      activatedAt: new Date().toISOString(),
    };

    await redis.set(`setup:${setupToken}`, JSON.stringify(updated));
    await redis.set(`widget:${widgetId}`, setupToken);

    const embedUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/embed/${widgetId}`;

    return res.status(200).json({ embedUrl, widgetId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function validateNotion(token, dbId) {
  try {
    const cleanDbId = dbId.replace(/-/g, '').trim();
    const r = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (r.status === 401) return { ok: false, message: 'Token de Notion inválido.' };
    if (r.status === 403) return { ok: false, message: 'La integración no tiene acceso a esta base de datos. Agrégala en ··· → Connections.' };
    if (r.status === 404) return { ok: false, message: 'Base de datos no encontrada. Verifica el ID.' };
    if (!r.ok) return { ok: false, message: `Error de Notion: ${r.status}` };

    return { ok: true };
  } catch {
    return { ok: false, message: 'No se pudo conectar con Notion.' };
  }
}
