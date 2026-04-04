import crypto from 'crypto';
import { Resend } from 'resend';
import { Redis } from '@upstash/redis';

const resend = new Resend(process.env.RESEND_API_KEY);
const redis = Redis.fromEnv();

function verifySignature(rawBody, signature) {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `TCE-${segment(4)}-${segment(4)}-${segment(4)}`;
}

function generateSetupToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers['x-signature'];

    if (!verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody);
    const eventName = payload.meta?.event_name;

    if (eventName !== 'order_created') {
      return res.status(200).json({ received: true });
    }

    const order = payload.data.attributes;
    const email = order.user_email;
    const customerName = order.user_name || 'Creator';
    const orderId = payload.data.id;
    const variantId = order.first_order_item?.variant_id?.toString();

    const PRO_VARIANT_ID = process.env.LS_PRO_VARIANT_ID;
    const plan = variantId === PRO_VARIANT_ID ? 'pro' : 'free';

    const licenseKey = generateLicenseKey();
    const setupToken = generateSetupToken();

    const licenseData = {
      email,
      customerName,
      plan,
      orderId,
      licenseKey,
      setupToken,
      createdAt: new Date().toISOString(),
      activated: false,
      notionToken: null,
      notionDbId: null,
      widgetId: null,
    };

    await redis.set(`setup:${setupToken}`, JSON.stringify(licenseData), { ex: 60 * 60 * 24 * 30 });
    await redis.set(`license:${licenseKey}`, setupToken);

    const setupUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/setup.html?token=${setupToken}`;

    await resend.emails.send({
      from: 'The Content Edit <onboarding@resend.dev>',
      to: email,
      subject: '✦ Tu widget está listo — empieza el setup',
      html: getEmailHTML({ customerName, licenseKey, setupUrl, plan }),
    });

    return res.status(200).json({ success: true, licenseKey });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getEmailHTML({ customerName, licenseKey, setupUrl, plan }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F9F6F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid rgba(28,25,21,0.1);overflow:hidden;">
    <div style="background:#1C1915;padding:28px 32px;">
      <p style="margin:0;font-size:15px;letter-spacing:0.06em;text-transform:uppercase;color:rgba(249,246,241,0.6);">The Content Edit</p>
    </div>
    <div style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:500;color:#1C1915;">Hola ${customerName} ✦</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#7A7570;line-height:1.6;">Tu widget ${plan === 'pro' ? 'Pro' : ''} está listo. Guarda este email — aquí están tus credenciales únicas.</p>
      <div style="background:#F9F6F1;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#7A7570;">Tu license key</p>
        <p style="margin:0;font-size:18px;font-weight:500;color:#1C1915;letter-spacing:0.06em;font-family:monospace;">${licenseKey}</p>
      </div>
      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:14px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;margin-bottom:20px;">Empezar setup →</a>
      <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">¿Algo no funciona? Escríbeme y lo resolvemos.<br/>© 2025 The Content Edit</p>
    </div>
  </div>
</body>
</html>`;
}

export const config = { api: { bodyParser: false } };
