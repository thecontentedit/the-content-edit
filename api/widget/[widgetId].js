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
  profilePhoto: 'Profile Photo',
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

    // POST: save custom order (Pro only)
    if (req.method === 'POST') {
      if (plan !== 'pro') return res.status(403).json({ error: 'Pro plan required' });
      const { orderedIds } = req.body;
      if (!orderedIds || !Array.isArray(orderedIds)) return res.status(400).json({ error: 'Invalid order' });
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
          body: JSON.stringify({ properties: { 'Publish Date': { date: { start: dateStr } } } }),
        });
      }));
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
      page_size: limit + 1,
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

function formatPost(page) {
  const props = page.properties;

  const name = props[PROPS.name]?.title?.[0]?.plain_text || '';
  const dateRaw = props[PROPS.publishDate]?.date?.start;
  const publishDate = dateRaw
    ? new Date(dateRaw).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  // Attachment files (can be multiple for carousel)
  const attachments = props[PROPS.attachment]?.files || [];
  const attachmentUrls = attachments.map(f =>
    f.type === 'file' ? f.file.url : f.external?.url
  ).filter(Boolean);

  // Link field (text, can have multiple URLs separated by newlines)
  const linkText = props[PROPS.link]?.rich_text?.map(r => r.plain_text).join('') || '';
  const linkUrls = linkText.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));

  // Determine images array — attachments take priority over links
  let images = [];
  if (attachmentUrls.length > 0) {
    images = attachmentUrls;
  } else if (linkUrls.length > 0) {
    images = linkUrls;
  }

  // First image for grid thumbnail
  const imageUrl = images[0] || null;

  // Auto-detect carousel if multiple images
  let mediaType = props[PROPS.mediaType]?.select?.name?.toLowerCase() || 'photo';
  if (images.length > 1 && mediaType === 'photo') mediaType = 'carousel';

  const pinned = props[PROPS.pinned]?.checkbox || false;

  return { name, publishDate, imageUrl, images, mediaType, pinned, pageId: page.id };
}
