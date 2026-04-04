// api/widget/[widgetId].js
// Lee las credenciales de Notion del usuario y devuelve sus posts formateados
// Este endpoint lo llama el widget HTML embebido en Notion

import { kv } from '@vercel/kv';
import { decryptToken } from '../setup.js';

// Propiedades esperadas en la base de datos de Notion del usuario
const PROPS = {
  name:        'Name',
  publishDate: 'Publish Date',
  attachment:  'Attachment',
  link:        'Link',
  pinned:      'Pinned',
  mediaType:   'Media Type',   // select: photo | carousel | reel
};

export default async function handler(req, res) {
  // CORS — el widget se embebe como iframe en Notion
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') return res.status(405).end();

  const { widgetId } = req.query;

  try {
    // Busca el setupToken asociado a este widgetId
    const setupToken = await kv.get(`widget:${widgetId}`);
    if (!setupToken) return res.status(404).json({ error: 'Widget no encontrado' });

    const data = await kv.get(`setup:${setupToken}`);
    if (!data || !data.activated) return res.status(403).json({ error: 'Widget no activado' });

    // Descifra el token de Notion
    const notionToken = decryptToken(data.notionToken);
    const dbId = data.notionDbId.replace(/-/g, '');
    const plan = data.plan;

    // Límite de posts según el plan
    const limit = plan === 'pro' ? 60 : 9;

    // Consulta la DB de Notion ordenada por Publish Date descendente
    const posts = await fetchNotionPosts(notionToken, dbId, limit);

    // Separamos los posts fijados (solo pro) y los normales
    const pinned  = plan === 'pro' ? posts.filter(p => p.pinned) : [];
    const regular = posts.filter(p => !p.pinned);
    const ordered = [...pinned, ...regular].slice(0, limit);

    // Cache de 60 segundos para no hammear Notion en cada render del iframe
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

    return res.status(200).json({ posts: ordered, plan });

  } catch (err) {
    console.error('Widget API error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

async function fetchNotionPosts(token, dbId, limit) {
  const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      page_size: limit,
      sorts: [{ property: PROPS.publishDate, direction: 'descending' }],
    }),
  });

  if (!response.ok) throw new Error(`Notion API ${response.status}`);

  const data = await response.json();
  return data.results.map(page => formatPost(page));
}

function formatPost(page) {
  const props = page.properties;

  // Nombre / título del post
  const name = props[PROPS.name]?.title?.[0]?.plain_text || '';

  // Fecha de publicación
  const dateRaw = props[PROPS.publishDate]?.date?.start;
  const publishDate = dateRaw
    ? new Date(dateRaw).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  // Imagen: primero intentamos el archivo adjunto, luego el link externo
  const attachments = props[PROPS.attachment]?.files || [];
  let imageUrl = null;

  if (attachments.length > 0) {
    const file = attachments[0];
    // Notion tiene dos tipos: 'file' (hosted por Notion, URL temporal) y 'external'
    imageUrl = file.type === 'file' ? file.file.url : file.external?.url;
  }

  // Si no hay adjunto, usamos el link externo (Canva, Pinterest, URL directa)
  const externalLink = props[PROPS.link]?.url || null;
  if (!imageUrl && externalLink) {
    imageUrl = resolveImageUrl(externalLink);
  }

  // Tipo de media para los íconos
  const mediaType = props[PROPS.mediaType]?.select?.name?.toLowerCase() || 'photo';

  // Post fijado
  const pinned = props[PROPS.pinned]?.checkbox || false;

  return { name, publishDate, imageUrl, mediaType, pinned, pageId: page.id };
}

// Intenta convertir links de Canva/Pinterest a una URL de imagen directa
function resolveImageUrl(url) {
  if (!url) return null;

  // Canva share links — usamos el OG image como preview
  // (en producción podrías usar una API de scraping para esto)
  if (url.includes('canva.com')) {
    // Canva no expone imagen directa sin auth; devolvemos el link para manejo en el widget
    return `__canva__${url}`;
  }

  // Pinterest — igual, marcamos para manejo especial en el widget
  if (url.includes('pinterest.com') || url.includes('pin.it')) {
    return `__pinterest__${url}`;
  }

  // URL directa de imagen — la usamos tal cual
  return url;
}
