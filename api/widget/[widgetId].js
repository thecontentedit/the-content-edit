import { Redis } from '@upstash/redis';
import { decryptToken } from '../setup.js';
const redis = Redis.fromEnv();

const PROPS = {
  name:        'Name',
  publishDate: 'Publish Date',
  attachment:  'Attachment',
  link:        'Link',
  pinned:      'Pinned',
  mediaType:   'Media Type',
  type:        'Type',
  displayName: 'Display Name',
  username:    'Username',
  bio:         'Bio',
  website:     'Website',
  h1photo:     'Highlight 1 Photo',
  h1label:     'Highlight 1 Label',
  h2photo:     'Highlight 2 Photo',
  h2label:     'Highlight 2 Label',
  h3photo:     'Highlight 3 Photo',
  h3label:     'Highlight 3 Label',
  h4photo:     'Highlight 4 Photo',
  h4label:     'Highlight 4 Label',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method !== 'GET') return res.status(405).end();

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

    // Fetch all pages (posts + profile row)
    const allPages = await fetchAllPages(notionToken, dbId, limit);

    // Separate profile from posts
    const profilePage = allPages.find(p => {
      const typeVal = p.properties[PROPS.type]?.select?.name?.toLowerCase();
      return typeVal === 'profile';
    });

    const postPages = allPages.filter(p => {
      const typeVal = p.properties[PROPS.type]?.select?.name?.toLowerCase();
      return typeVal !== 'profile';
    });

    const profile = profilePage ? formatProfile(profilePage) : null;
    const posts = postPages.map(p => formatPost(p));

    const pinned  = plan === 'pro' ? posts.filter(p => p.pinned) : [];
    const regular = posts.filter(p => !p.pinned);
    const ordered = [...pinned, ...regular].slice(0, limit);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
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
      page_size: limit + 1, // +1 to account for profile row
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
    highlights: [
      { photo: getFile(PROPS.h1photo), label: getText(PROPS.h1label) },
      { photo: getFile(PROPS.h2photo), label: getText(PROPS.h2label) },
      { photo: getFile(PROPS.h3photo), label: getText(PROPS.h3label) },
      { photo: getFile(PROPS.h4photo), label: getText(PROPS.h4label) },
    ].filter(h => h.photo || h.label),
  };
}

function formatPost(page) {
  const props = page.properties;

  const name = props[PROPS.name]?.title?.[0]?.plain_text || '';
  const dateRaw = props[PROPS.publishDate]?.date?.start;
  const publishDate = dateRaw
    ? new Date(dateRaw).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const attachments = props[PROPS.attachment]?.files || [];
  let imageUrl = null;
  if (attachments.length > 0) {
    const file = attachments[0];
    imageUrl = file.type === 'file' ? file.file.url : file.external?.url;
  }

  const externalLink = props[PROPS.link]?.url || null;
  if (!imageUrl && externalLink) {
    imageUrl = externalLink.includes('canva.com')
      ? `__canva__${externalLink}`
      : externalLink.includes('pinterest') ? `__pinterest__${externalLink}` : externalLink;
  }

  const mediaType = props[PROPS.mediaType]?.select?.name?.toLowerCase() || 'photo';
  const pinned = props[PROPS.pinned]?.checkbox || false;

  return { name, publishDate, imageUrl, mediaType, pinned, pageId: page.id };
}
