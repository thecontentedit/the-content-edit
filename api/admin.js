import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const { password, email } = req.query;

  // Verificar contraseña
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || password !== adminPassword) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  // Solo verificar contraseña (para login)
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
  const base = process.env.NEXT_PUBLIC_BASE_URL;

  // Construir widgets
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
