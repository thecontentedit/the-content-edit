import { Redis } from '@upstash/redis';
import { decryptToken } from '../setup.js';
const redis = Redis.fromEnv();
const PROPS = {
  name:         'Título',
  publishDate:  'Fecha de publicación',
  attachment:   'Attachment',
  link:         'Link',
  canvaLink:    'Canva Link',
  imagenDesde:  'Imagen desde',
  pinned:       'Fijado',
  mediaType:    'Formato',
  type:         'Type',
  ocultar:      'Ocultar',
  displayName:  'Nombre',
  username:     'Usuario',
  bio:          'Bio',
  website:      'Sitio web',
  profilePhoto: 'Foto de perfil',
  h1photo:      'Highlight 1 Foto',
  h1label:      'Highlight 1 Nombre',
  h2photo:      'Highlight 2 Foto',
  h2label:      'Highlight 2 Nombre',
  h3photo:      'Highlight 3 Foto',
  h3label:      'Highlight 3 Nombre',
  h4photo:      'Highlight 4 Foto',
  h4label:      'Highlight 4 Nombre',
};
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { widgetId } = req.query;
  try {
    const setupToken = await redis.get(`widget:${widgetId}`);
    if (!setupToken) return res.status(404).json({ error: 'Widget no encontrado' });
    const raw = await redis.get(`setup:${setupToken}`);
    if (!raw) return res.status(403).json({ error: 'Widget no activado' });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data.activated) return res.status(403).json({ error: 'Widget no activado' });
    const notionToken = decryptToken(data.notionToken);
    const dbId = data.notionDbId.replace(/-/g, '');
    const plan = data.plan;
    const limit = plan === 'pro' ? 60 : 9;

    // ── POST: guardar orden del Plan Grid (Pro only) ──
    if (req.method === 'POST') {
      if (plan !== 'pro') return res.status(403).json({ error: 'Pro plan required' });

      const { orderedIds, dateMap } = req.body;
      if (!orderedIds || !Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'Invalid order' });
      }

      // dateMap es un objeto { pageId: 'YYYY-MM-DD' } enviado por el frontend
      // Solo actualiza los posts que realmente cambiaron de fecha
      if (dateMap && typeof dateMap === 'object') {
        // Modo Plan Grid: cada pageId tiene su fecha ISO exacta
        await Promise.all(
          Object.entries(dateMap).map(async ([pageId, dateStr]) => {
            await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${notionToken}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                properties: {
                  [PROPS.publishDate]: { date: { start: dateStr } },
                },
              }),
            });
          })
        );
      } else {
        // Modo legacy (orden personalizado sin Plan Grid):
        // genera fechas desde hoy hacia atrás según posición
        const baseDate = new Date();
        await Promise.all(orderedIds.map(async (pageId, idx) => {
          const d = new Date(baseDate);
          d.setDate(d.getDate() - idx);
          const dateStr = d.toISOString().split('T')[0];
          await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: {
                [PROPS.publishDate]: { date: { start: dateStr } },
              },
            }),
          });
        }));
      }

      return res.status(200).json({ success: true });
    }

    if (req.method !== 'GET') return res.status(405).end();

    const allPages = await fetchAllPages(notionToken, dbId, limit);
    const profilePage = allPages.find(p => {
      const typeVal = p.properties[PROPS.type]?.select?.name?.toLowerCase();
      return typeVal === 'profile';
    });
    const postPages = allPages.filter(p => {
      const typeVal = p.properties[PROPS.type]?.select?.name?.toLowerCase();
      if (typeVal === 'profile') return false;
      const ocultar = p.properties[PROPS.ocultar]?.checkbox;
      if (ocultar) return false;
      return true;
    });
    const profile = profilePage ? formatProfile(profilePage) : null;
    const posts = postPages.map(p => formatPost(p));
    const pinned  = plan === 'pro' ? posts.filter(p => p.pinned) : [];
    const regular = posts.filter(p => !p.pinned);
    const ordered = [...pinned, ...regular].slice(0, limit);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
    return res.status(200).json({ posts: ordered, plan, profile });
  } catch (err) {
    console.error('Widget API error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

async function fetchAllPages(token, dbId, limit) {
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      page_size: limit + 5,
      sorts: [{ property: PROPS.publishDate, direction: 'descending' }],
    }),
  });
  if (!response.ok) throw new Error(`Notion API ${response.status}`);
  const data = await response.json();
  return data.results;
}

function formatProfile(page) {
  const props = page.properties;
  const getFile = (prop) => {
    const files = props[prop]?.files || [];
    if (!files.length) return null;
    const f = files[0];
    return f.type === 'file' ? f.file.url : f.external?.url;
  };
  const getText = (prop) => {
    const rich = props[prop]?.rich_text;
    if (rich && rich.length) return rich.map(r => r.plain_text).join('');
    const title = props[prop]?.title;
    if (title && title.length) return title.map(r => r.plain_text).join('');
    return null;
  };
  return {
    username:    getText(PROPS.username),
    displayName: getText(PROPS.displayName),
    bio:         getText(PROPS.bio),
    website:     props[PROPS.website]?.url || null,
    avatarUrl:   getFile(PROPS.profilePhoto),
    highlights: [
      { photo: getFile(PROPS.h1photo), label: getText(PROPS.h1label) },
      { photo: getFile(PROPS.h2photo), label: getText(PROPS.h2label) },
      { photo: getFile(PROPS.h3photo), label: getText(PROPS.h3label) },
      { photo: getFile(PROPS.h4photo), label: getText(PROPS.h4label) },
    ].filter(h => h.photo || h.label),
  };
}

function normalizeLink(url) {
  if (!url) return null;
  if (url.includes('dropbox.com')) {
    return url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '').replace('?dl=1', '');
  }
  return url;
}

function formatPost(page) {
  const props = page.properties;
  const name = props[PROPS.name]?.title?.[0]?.plain_text || '';
  const dateRaw = props[PROPS.publishDate]?.date?.start;

  // Guardamos la fecha ISO (YYYY-MM-DD) además del string formateado
  // El frontend la necesita para construir el dateMap al guardar Plan Grid
  let publishDate = null;
  let publishDateISO = null;
  if (dateRaw) {
    publishDateISO = dateRaw.split('T')[0];
    const [year, month, day] = publishDateISO.split('-');
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    publishDate = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const tipoImagen = props[PROPS.imagenDesde]?.select?.name?.toLowerCase() || '';
  const attachments = props[PROPS.attachment]?.files || [];
  const attachmentUrls = attachments.map(f =>
    f.type === 'file' ? f.file.url : f.external?.url
  ).filter(Boolean);
  const linkText = props[PROPS.link]?.rich_text?.map(r => r.plain_text).join('') || '';
  const linkUrls = linkText.split('\n').map(l => normalizeLink(l.trim())).filter(l => l && l.startsWith('http'));
  let canvaUrl = props[PROPS.canvaLink]?.url || null;
  if (canvaUrl && !canvaUrl.includes('?embed')) {
    canvaUrl = canvaUrl.split('?')[0] + '?embed';
  }
  let images = [];
  let imageSource = 'attachment';
  if (tipoImagen === 'canva' && canvaUrl) {
    imageSource = 'canva'; images = [canvaUrl];
  } else if (tipoImagen === 'link' && linkUrls.length > 0) {
    imageSource = 'link'; images = linkUrls;
  } else if (tipoImagen === 'archivo' && attachmentUrls.length > 0) {
    imageSource = 'attachment'; images = attachmentUrls;
  } else {
    if (attachmentUrls.length > 0) { imageSource = 'attachment'; images = attachmentUrls; }
    else if (canvaUrl) { imageSource = 'canva'; images = [canvaUrl]; }
    else if (linkUrls.length > 0) { imageSource = 'link'; images = linkUrls; }
  }
  const imageUrl = images[0] || null;
  let mediaType = props[PROPS.mediaType]?.select?.name?.toLowerCase() || 'foto';
  if (images.length > 1 && mediaType === 'foto') mediaType = 'carrusel';
  const pinned = props[PROPS.pinned]?.checkbox || false;

  return { name, publishDate, publishDateISO, imageUrl, images, imageSource, mediaType, pinned, pageId: page.id };
}
