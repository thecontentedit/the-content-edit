// api/webhook.js
// Recibe el webhook de Lemon Squeezy cuando alguien compra
// Genera un license key único, lo guarda en KV, manda el email con el setup link

import crypto from 'crypto';
import { Resend } from 'resend';
import { kv } from '@vercel/kv';

const resend = new Resend(process.env.RESEND_API_KEY);

// Verifica que el webhook venga realmente de Lemon Squeezy
function verifySignature(rawBody, signature) {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

// Genera un license key único tipo TCE-XXXX-XXXX-XXXX
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `TCE-${segment(4)}-${segment(4)}-${segment(4)}`;
}

// Genera un setup token único (URL-safe, 32 chars)
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

    // Solo procesamos pagos completados
    if (eventName !== 'order_created') {
      return res.status(200).json({ received: true });
    }

    const order = payload.data.attributes;
    const email = order.user_email;
    const customerName = order.user_name || 'Creator';
    const orderId = payload.data.id;
    const variantId = order.first_order_item?.variant_id?.toString();

    // Determina el plan según el variant ID de Lemon Squeezy
    const PRO_VARIANT_ID = process.env.LS_PRO_VARIANT_ID;
    const plan = variantId === PRO_VARIANT_ID ? 'pro' : 'free';

    // Genera credenciales únicas
    const licenseKey = generateLicenseKey();
    const setupToken = generateSetupToken();

    // Guarda en Vercel KV
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

    // Indexamos por setupToken (para el setup flow) y por licenseKey (para soporte)
    await kv.set(`setup:${setupToken}`, licenseData, { ex: 60 * 60 * 24 * 30 }); // 30 días para hacer setup
    await kv.set(`license:${licenseKey}`, setupToken);

    // Manda el email con el setup link
    const setupUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/setup?token=${setupToken}`;

    await resend.emails.send({
      from: 'The Content Edit <hola@thecontentedit.co>',
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

// Lee el body raw para verificar la firma HMAC
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Template del email de bienvenida
function getEmailHTML({ customerName, licenseKey, setupUrl, plan }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#F9F6F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;border:1px solid rgba(28,25,21,0.1);overflow:hidden;">
    
    <div style="background:#1C1915;padding:28px 32px;">
      <p style="margin:0;font-size:15px;letter-spacing:0.06em;text-transform:uppercase;color:rgba(249,246,241,0.6);">The Content Edit</p>
    </div>

    <div style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:500;color:#1C1915;letter-spacing:-0.02em;">
        Hola ${customerName} ✦
      </h1>
      <p style="margin:0 0 24px;font-size:15px;color:#7A7570;line-height:1.6;">
        Tu ${plan === 'pro' ? 'widget Pro' : 'widget'} está listo. Guarda este email — aquí están tus credenciales únicas y tu link de setup.
      </p>

      <div style="background:#F9F6F1;border-radius:8px;padding:16px 20px;margin-bottom:24px;border:1px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 4px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#7A7570;">Tu license key</p>
        <p style="margin:0;font-size:18px;font-weight:500;color:#1C1915;letter-spacing:0.06em;font-family:monospace;">${licenseKey}</p>
      </div>

      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:14px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;margin-bottom:20px;">
        Empezar setup →
      </a>

      <p style="margin:0 0 8px;font-size:13px;color:#7A7570;line-height:1.6;">
        El setup tarda menos de 5 minutos. Solo necesitas crear una integración gratuita en Notion y pegar tu token — las instrucciones están en la página.
      </p>

      <p style="margin:0;font-size:13px;color:#7A7570;line-height:1.6;">
        <strong style="color:#1C1915;">Importante:</strong> guarda este link de setup, es único y personal.<br/>
        <span style="font-size:11px;word-break:break-all;color:#aaa;">${setupUrl}</span>
      </p>
    </div>

    <div style="padding:20px 32px;border-top:1px solid rgba(28,25,21,0.08);">
      <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
        ¿Algo no funciona? Escríbeme a hola@thecontentedit.co y lo resolvemos juntas.<br/>
        © 2025 The Content Edit
      </p>
    </div>

  </div>
</body>
</html>`;
}

export const config = { api: { bodyParser: false } };
