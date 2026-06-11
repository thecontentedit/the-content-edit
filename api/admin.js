import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

const redis = Redis.fromEnv();
const resend = new Resend(process.env.RESEND_API_KEY);

function checkAuth(req, res) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const password = req.query.password || req.body?.password;
  if (!adminPassword || password !== adminPassword) {
    res.status(401).json({ ok: false, error: 'No autorizado' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {

  // ── GET: login, buscar usuario, o listar todos ────────────────────────────
  if (req.method === 'GET') {
    if (!checkAuth(req, res)) return;

    const { email, list } = req.query;
    const base = process.env.NEXT_PUBLIC_BASE_URL;

    // Listar todos los usuarios
    if (list === 'true') {
      const emailKeys = await redis.keys('email:*');
      const users = [];
      for (const key of emailKeys) {
        const userEmail = key.replace('email:', '');
        const setupToken = await redis.get(key);
        if (!setupToken) continue;
        const raw = await redis.get(`setup:${setupToken}`);
        if (!raw) continue;
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        users.push({
          email: data.email || userEmail,
          plan: data.plan || 'free',
          activated: data.activated || false,
          createdAt: data.createdAt || null,
          widgetCount: (data.widgets || []).length || (data.widgetId ? 1 : 0),
        });
      }
      users.sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      return res.status(200).json({ ok: true, users });
    }

    // Solo login (sin email)
    if (!email) {
      return res.status(200).json({ ok: true });
    }

    // Buscar usuario por email
    const setupToken = await redis.get(`email:${email}`);
    if (!setupToken) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
    }
    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) {
      return res.status(404).json({ ok: false, error: 'Datos no encontrados.' });
    }
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    let widgets = data.widgets || [];
    if (!widgets.length && data.widgetId) {
      widgets = [{
        widgetId: data.widgetId,
        name: 'Widget #1',
        notionDbId: data.notionDbId || null,
        createdAt: data.activatedAt || null,
      }];
    }

    return res.status(200).json({
      ok: true,
      user: {
        email: data.email,
        plan: data.plan,
        activated: data.activated,
        licenseKey: data.licenseKey || null,
        setupToken,
        createdAt: data.createdAt || null,
        widgets: widgets.map(w => ({
          widgetId: w.widgetId,
          name: w.name,
          embedUrl: `${base}/embed/${w.widgetId}`,
          notionDbId: w.notionDbId || null,
          createdAt: w.createdAt || null,
        })),
      },
    });
  }

  // ── POST: cambiar plan o reenviar email ───────────────────────────────────
  if (req.method === 'POST') {
    if (!checkAuth(req, res)) return;

    const { action, email } = req.body;
    const base = process.env.NEXT_PUBLIC_BASE_URL;

    if (!email) return res.status(400).json({ ok: false, error: 'Falta email' });

    const setupToken = await redis.get(`email:${email}`);
    if (!setupToken) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });

    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) return res.status(404).json({ ok: false, error: 'Datos no encontrados.' });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Cambiar plan
    if (action === 'change_plan') {
      const { plan } = req.body;
      if (!plan || !['free', 'pro'].includes(plan)) {
        return res.status(400).json({ ok: false, error: 'Plan inválido' });
      }
      const updated = { ...data, plan, upgradedAt: new Date().toISOString() };
      await redis.set(`setup:${setupToken}`, JSON.stringify(updated));
      return res.status(200).json({ ok: true, message: `Plan cambiado a ${plan}` });
    }

    // Reenviar email de setup
    if (action === 'resend_email') {
      const setupUrl = `${base}/setup.html?token=${setupToken}`;
      const customerName = data.customerName || '';
      const firstName = customerName ? customerName.split(' ')[0] : '';

      await resend.emails.send({
        from: 'The Content Edit <hola@thecontentedit.digital>',
        to: email,
        subject: firstName ? `Tu link de setup, ${firstName}` : 'Tu link de setup — The Content Edit',
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"/></head>
          <body style="margin:0;padding:0;background:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            <div style="max-width:520px;margin:40px auto;background:#F9F6F1;border-radius:12px;border:1px solid rgba(28,25,21,0.1);overflow:hidden;">
              <div style="background:#1C1915;padding:24px 32px;">
                <p style="margin:0;font-size:22px;color:#F9F6F1;font-weight:400;">The Content Edit</p>
              </div>
              <div style="padding:32px 32px 24px;">
                <h1 style="margin:0 0 12px;font-size:20px;font-weight:500;color:#1C1915;">
                  ${firstName ? `Hola, ${firstName} 🤍` : 'Hola 🤍'}
                </h1>
                <p style="margin:0 0 24px;font-size:13px;color:#5F5E5A;line-height:1.6;">
                  Aquí está tu link de setup. Guárdalo — es tu acceso personal al widget.
                </p>
                <div style="background:#ECEAE5;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
                  <p style="margin:0;font-size:11px;color:#888780;margin-bottom:4px;">Plan actual</p>
                  <p style="margin:0;font-size:14px;font-weight:600;color:#1C1915;text-transform:capitalize;">${data.plan || 'free'}</p>
                </div>
                <a href="${setupUrl}" style="display:block;background:#1C1915;color:#F9F6F1;text-align:center;padding:13px 20px;border-radius:999px;font-size:14px;font-weight:500;text-decoration:none;">
                  Ir a mi setup →
                </a>
              </div>
              <div style="padding:18px 32px 20px;border-top:0.5px solid #D3D1C7;">
                <p style="margin:0;font-size:12px;color:#888780;">
                  ¿Dudas? Escríbenos a <a href="mailto:hola@thecontentedit.digital" style="color:#888780;">hola@thecontentedit.digital</a>
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      return res.status(200).json({ ok: true, message: 'Email enviado' });
    }

    return res.status(400).json({ ok: false, error: 'Acción no reconocida' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
