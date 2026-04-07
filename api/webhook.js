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
    const customerName = order.user_name || '';
    const orderId = payload.data.id;
    const variantId = order.first_order_item?.variant_id?.toString();

    const PRO_VARIANT_ID = process.env.LS_PRO_VARIANT_ID;
    const plan = variantId === PRO_VARIANT_ID ? 'pro' : 'free';

    // ── UPGRADE FLOW: buscar si ya existe un usuario con este email ──
    if (plan === 'pro') {
      const existingSetupToken = await redis.get(`email:${email}`);
      if (existingSetupToken) {
        const raw = await redis.get(`setup:${existingSetupToken}`);
        if (raw) {
          const existingData = typeof raw === 'string' ? JSON.parse(raw) : raw;

          const updated = {
            ...existingData,
            plan: 'pro',
            upgradedAt: new Date().toISOString(),
          };
          await redis.set(`setup:${existingSetupToken}`, JSON.stringify(updated));

          const setupUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/setup.html?token=${existingSetupToken}`;

          await resend.emails.send({
            from: 'The Content Edit <hola@thecontentedit.digital>',
            to: email,
            subject: '¡Ya eres Pro! Tu widget se actualizó',
            html: getUpgradeEmailHTML({ customerName, setupUrl }),
          });

          return res.status(200).json({ success: true, upgraded: true });
        }
      }
    }

    // ── NUEVO USUARIO: crear registro normalmente ──
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
    await redis.set(`email:${email}`, setupToken);

    const setupUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/setup.html?token=${setupToken}`;

    const firstName = customerName ? customerName.split(' ')[0] : '';

    await resend.emails.send({
      from: 'The Content Edit <hola@thecontentedit.digital>',
      to: email,
      subject: firstName ? `Tu widget está listo, ${firstName}` : 'Tu widget está listo',
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
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hola, ${firstName} 🤍` : 'Hola 🤍';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#F9F6F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#F9F6F1;border-radius:12px;border:1px solid rgba(28,25,21,0.1);overflow:hidden;">

    <div style="background:#1C1915;padding:24px 32px;">
      <p style="margin:0;font-size:22px;color:#F9F6F1;font-family:'DM Serif Display',Georgia,serif;font-weight:400;">The Content Edit</p>
    </div>

    <div style="padding:32px 32px 24px;">
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:500;color:#1C1915;">${greeting}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#5F5E5A;line-height:1.5;">Tu widget está listo. Guarda este email — aquí están tus credenciales únicas.</p>

      <div style="background:#ECEAE5;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0 0 5px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#888780;">Tu license key</p>
        <p style="margin:0;font-size:15px;font-weight:500;color:#1C1915;letter-spacing:0.05em;font-family:monospace;">${licenseKey}</p>
      </div>

      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;margin-bottom:20px;">Empezar setup →</a>

      <div style="background:#F0EDE7;border-radius:8px;padding:14px 16px;">
        <p style="margin:0 0 8px;font-size:13px;color:#5F5E5A;line-height:1.55;">¿Quieres usar imágenes de Canva o links externos? Eso es exclusivo del plan Pro.</p>
        <a href="https://thecontentedit.lemonsqueezy.com/checkout/buy/827cbae3-e9c5-4912-ad09-701097b4c3d6?logo=0&discount=0" style="font-size:13px;color:#1C1915;font-weight:500;text-decoration:underline;">Ver plan Pro →</a>
      </div>
    </div>

    <div style="padding:18px 32px 20px;border-top:0.5px solid #D3D1C7;">
      <p style="margin:0;font-size:12px;color:#888780;line-height:1.6;">¿Dudas? Escríbenos a <a href="mailto:hola@thecontentedit.digital" style="color:#888780;text-decoration:underline;">hola@thecontentedit.digital</a><br/>© The Content Edit. Solo para uso personal — prohibida su redistribución o reventa.</p>
    </div>

  </div>
</body>
</html>`;
}

function getUpgradeEmailHTML({ customerName, setupUrl }) {
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `¡Ya eres Pro, ${firstName}! 🤍` : '¡Ya eres Pro! 🤍';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#F9F6F1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#F9F6F1;border-radius:12px;border:1px solid rgba(28,25,21,0.1);overflow:hidden;">

    <div style="background:#1C1915;padding:24px 32px;">
      <p style="margin:0;font-size:22px;color:#F9F6F1;font-family:'DM Serif Display',Georgia,serif;font-weight:400;">The Content Edit</p>
    </div>

    <div style="padding:32px 32px 24px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:500;color:#1C1915;">${greeting}</h1>
      <p style="margin:0 0 24px;font-size:13px;color:#5F5E5A;line-height:1.6;">Tu widget se actualizó automáticamente. Solo refresca el widget en Notion y ya tendrás todas las funciones Pro activas.</p>

      <div style="background:#ECEAE5;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#1C1915;line-height:1.8;">✓ Plan Grid<br/>✓ Imágenes desde Canva y links externos<br/>✓ Profile Preview (Bio mode)</p>
      </div>

      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;">Ver mis links →</a>
    </div>

    <div style="padding:18px 32px 20px;border-top:0.5px solid #D3D1C7;">
      <p style="margin:0;font-size:12px;color:#888780;line-height:1.6;">¿Algo no funciona? Escríbenos a <a href="mailto:hola@thecontentedit.digital" style="color:#888780;text-decoration:underline;">hola@thecontentedit.digital</a><br/>© The Content Edit. Solo para uso personal — prohibida su redistribución o reventa.</p>
    </div>

  </div>
</body>
</html>`;
}

export const config = { api: { bodyParser: false } };
