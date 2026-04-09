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

    // ── UPGRADE FLOW ──
    if (plan === 'pro') {
      const existingSetupToken = await redis.get(`email:${email}`);
      if (existingSetupToken) {
        const raw = await redis.get(`setup:${existingSetupToken}`);
        if (raw) {
          const existingData = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const updated = { ...existingData, plan: 'pro', upgradedAt: new Date().toISOString() };
          await redis.set(`setup:${existingSetupToken}`, JSON.stringify(updated));
          const setupUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/activate.html?token=${existingSetupToken}`;
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

    // ── NUEVO USUARIO ──
    const licenseKey = generateLicenseKey();
    const setupToken = generateSetupToken();

    const licenseData = {
      email, customerName, plan, orderId, licenseKey, setupToken,
      createdAt: new Date().toISOString(),
      activated: false, notionToken: null, notionDbId: null, widgetId: null,
    };

    await redis.set(`setup:${setupToken}`, JSON.stringify(licenseData), { ex: 60 * 60 * 24 * 30 });
    await redis.set(`license:${licenseKey}`, setupToken);
    await redis.set(`email:${email}`, setupToken);

    const setupUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/activate.html?token=${setupToken}`;
    const firstName = customerName ? customerName.split(' ')[0] : '';

    await resend.emails.send({
      from: 'The Content Edit <hola@thecontentedit.digital>',
      to: email,
      subject: plan === 'pro'
        ? 'Bienvenida al plan Pro — tu widget está listo'
        : firstName ? `Tu widget está listo, ${firstName}` : 'Tu widget está listo',
      html: plan === 'pro'
        ? getProEmailHTML({ customerName, licenseKey, setupUrl })
        : getFreeEmailHTML({ customerName, licenseKey, setupUrl }),
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

const CHECKOUT_PRO = 'https://thecontentedit.lemonsqueezy.com/checkout/buy/cd1c69d1-0d45-48a1-90e4-8e489f2aac0c?logo=0';

const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap" rel="stylesheet"/>';

const FEATURES_GRID = `
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="width:50%;vertical-align:top;padding:10px 10px 10px 0;border-bottom:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">🎨 Canva Connect</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Pega tu link y el diseño aparece directo. Sin exportar nada.</p>
      </td>
      <td style="width:50%;vertical-align:top;padding:10px 0 10px 12px;border-left:0.5px solid rgba(28,25,21,0.08);border-bottom:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">🔗 Links externos</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Pinterest, URLs, lo que sea. Solo pega y aparece.</p>
      </td>
    </tr>
    <tr>
      <td style="width:50%;vertical-align:top;padding:10px 10px 10px 0;border-bottom:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">👤 Profile Preview</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Ve cómo se verá tu bio de Instagram antes de tocar nada.</p>
      </td>
      <td style="width:50%;vertical-align:top;padding:10px 0 10px 12px;border-left:0.5px solid rgba(28,25,21,0.08);border-bottom:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">🗺️ Content Map</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Ve tu feed por pilares y sabe si está balanceado, no solo bonito.</p>
      </td>
    </tr>
    <tr>
      <td style="width:50%;vertical-align:top;padding:10px 10px 10px 0;border-bottom:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">📅 Plan Grid</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Mueve posts entre fechas con drag & drop y guarda el orden.</p>
      </td>
      <td style="width:50%;vertical-align:top;padding:10px 0 10px 12px;border-left:0.5px solid rgba(28,25,21,0.08);border-bottom:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">🌙 Dark mode</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Cambia entre modo claro y oscuro según tu aesthetic.</p>
      </td>
    </tr>
    <tr>
      <td style="width:50%;vertical-align:top;padding:10px 10px 0 0;">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">⊞ Vista 5 columnas</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Ve tu feed tal como se ve en Instagram desde desktop.</p>
      </td>
      <td style="width:50%;vertical-align:top;padding:10px 0 0 12px;border-left:0.5px solid rgba(28,25,21,0.08);">
        <p style="margin:0 0 2px;font-size:12px;font-weight:500;color:#1C1915;">▶️ Carruseles y reels</p>
        <p style="margin:0;font-size:11px;color:#5F5E5A;line-height:1.5;">Navega carruseles y previsualiza reels sin salir de Notion.</p>
      </td>
    </tr>
  </table>`;

const FOOTER = `
  <div style="padding:18px 32px 20px;border-top:0.5px solid #D3D1C7;">
    <p style="margin:0;font-size:12px;color:#888780;line-height:1.6;">
      ¿Dudas? Escríbenos a <a href="mailto:hola@thecontentedit.digital" style="color:#888780;text-decoration:underline;">hola@thecontentedit.digital</a><br/>
      © The Content Edit. Solo para uso personal — prohibida su redistribución o reventa.
    </p>
  </div>`;

function emailWrapper(content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  ${FONT_LINK}
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#F9F6F1;border-radius:12px;border:1px solid rgba(28,25,21,0.1);overflow:hidden;">
    <div style="background:#1C1915;padding:24px 32px;">
      <p style="margin:0;font-size:22px;color:#F9F6F1;font-family:'DM Serif Display',Georgia,serif;font-weight:400;">The Content Edit</p>
    </div>
    ${content}
    ${FOOTER}
  </div>
</body>
</html>`;
}

function getFreeEmailHTML({ customerName, licenseKey, setupUrl }) {
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hola, ${firstName} 🤍` : 'Hola 🤍';
  return emailWrapper(`
    <div style="padding:32px 32px 24px;">
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:500;color:#1C1915;">${greeting}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#5F5E5A;line-height:1.5;">Tu widget está listo. Guarda este email — aquí están tus credenciales únicas.</p>

      <div style="background:#ECEAE5;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0 0 5px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#888780;">Tu license key</p>
        <p style="margin:0;font-size:15px;font-weight:500;color:#1C1915;letter-spacing:0.05em;font-family:monospace;">${licenseKey}</p>
      </div>

      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;margin-bottom:20px;">Empezar setup →</a>

      <div style="height:0.5px;background:#D3D1C7;margin-bottom:16px;"></div>

      <div style="background:#ECEAE5;border-radius:8px;padding:16px;">
        <p style="margin:0 0 12px;font-size:13px;font-weight:500;color:#1C1915;">Tu grid puede hacer más.</p>
        ${FEATURES_GRID}
        <a href="${CHECKOUT_PRO}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:11px 20px;border-radius:999px;font-size:13px;font-weight:500;text-decoration:none;margin-top:14px;">Quiero el plan Pro →</a>
      </div>
    </div>
  `);
}

function getProEmailHTML({ customerName, licenseKey, setupUrl }) {
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `Hola, ${firstName} 🤍` : 'Hola 🤍';
  return emailWrapper(`
    <div style="padding:32px 32px 24px;">
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:500;color:#1C1915;">${greeting}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#5F5E5A;line-height:1.5;">Tu widget Pro está listo. Guarda este email — aquí están tus credenciales únicas.</p>

      <div style="background:#ECEAE5;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0 0 5px;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#888780;">Tu license key</p>
        <p style="margin:0;font-size:15px;font-weight:500;color:#1C1915;letter-spacing:0.05em;font-family:monospace;">${licenseKey}</p>
      </div>

      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;margin-bottom:20px;">Empezar setup →</a>

      <div style="height:0.5px;background:#D3D1C7;margin-bottom:16px;"></div>

      <div style="background:#ECEAE5;border-radius:8px;padding:16px;">
        ${FEATURES_GRID}
      </div>
    </div>
  `);
}

function getUpgradeEmailHTML({ customerName, setupUrl }) {
  const firstName = customerName ? customerName.split(' ')[0] : '';
  const greeting = firstName ? `¡Ya eres Pro, ${firstName}! 🤍` : '¡Ya eres Pro! 🤍';
  return emailWrapper(`
    <div style="padding:32px 32px 24px;">
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:500;color:#1C1915;">${greeting}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#5F5E5A;line-height:1.6;">Tu widget se actualizó automáticamente. Solo refresca el widget en Notion y listo — todo ya está activo.</p>

      <div style="height:0.5px;background:#D3D1C7;margin-bottom:16px;"></div>

      <div style="background:#ECEAE5;border-radius:8px;padding:16px;margin-bottom:20px;">
        ${FEATURES_GRID}
      </div>

      <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;">Ver mis links →</a>
    </div>
  `);
}

export const config = { api: { bodyParser: false } };
