import { Redis } from '@upstash/redis';
import { decryptToken } from '../setup.js';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

async function queryNotionDB(token, dbId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 100, sorts: [{ property: 'Publish Date', direction: 'descending' }] }),
  });
  if (!res.ok) throw new Error(`Notion query failed: ${res.status}`);
  return res.json();
}

function extractImageUrl(post) {
  const props = post.properties;

  // Priority: Link > Canva Link > Attachment
  const link = props['Link']?.url;
  if (link) return link;

  const canva = props['Canva Link']?.url;
  if (canva) return canva;

  const files = props['Attachment']?.files;
  if (files && files.length > 0) {
    const f = files[0];
    return f.type === 'external' ? f.external.url : f.file?.url || null;
  }

  return null;
}

function extractProfile(page) {
  const props = page.properties;
  const highlights = [];

  for (let i = 1; i <= 4; i++) {
    const photo = props[`Highlight ${i} Photo`]?.files?.[0];
    const label = props[`Highlight ${i} Label`]?.rich_text?.[0]?.plain_text;
    const photoUrl = photo ? (photo.type === 'external' ? photo.external.url : photo.file?.url) : null;
    if (photoUrl || label) highlights.push({ photo: photoUrl, label: label || '' });
  }

  // Avatar from Attachment
  const avatarFiles = props['Attachment']?.files;
  const avatarUrl = avatarFiles?.[0]
    ? (avatarFiles[0].type === 'external' ? avatarFiles[0].external.url : avatarFiles[0].file?.url)
    : null;

  return {
    username: props['Username']?.rich_text?.[0]?.plain_text || props['Name']?.title?.[0]?.plain_text || null,
    displayName: props['Display Name']?.rich_text?.[0]?.plain_text || null,
    bio: props['Bio']?.rich_text?.[0]?.plain_text || null,
    website: props['Website']?.url || null,
    avatarUrl,
    highlights,
  };
}

async function updatePageDate(token, pageId, date) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        'Publish Date': { date: date ? { start: date } : null },
      },
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { widgetId } = req.query;
  if (!widgetId) return res.status(400).json({ error: 'Missing widgetId' });

  // Load widget data from Redis
  let widgetData;
  try {
    widgetData = await redis.get(`widget:${widgetId}`);
    if (!widgetData) return res.status(404).json({ error: 'Widget not found' });
  } catch {
    return res.status(500).json({ error: 'Redis error' });
  }

  let notionToken, dbId, plan;
  try {
    const decrypted = JSON.parse(decryptToken(widgetData));
    notionToken = decrypted.notionToken;
    dbId = decrypted.dbId;
    plan = decrypted.plan || 'free';
  } catch {
    return res.status(500).json({ error: 'Decryption error' });
  }

  // ── POST: save custom order ──
  if (req.method === 'POST') {
    if (plan !== 'pro') return res.status(403).json({ error: 'Pro plan required' });

    const { orderedIds } = req.body;
    if (!orderedIds || !Array.isArray(orderedIds)) return res.status(400).json({ error: 'Invalid order' });

    try {
      // Assign dates starting from today going back 1 day per post to maintain order
      const baseDate = new Date();
      await Promise.all(orderedIds.map(async (pageId, idx) => {
        const d = new Date(baseDate);
        d.setDate(d.getDate() - idx);
        const dateStr = d.toISOString().split('T')[0];
        await updatePageDate(notionToken, pageId, dateStr);
      }));
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update order', details: err.message });
    }
  }

  // ── GET: fetch posts ──
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = await queryNotionDB(notionToken, dbId);
    const limit = plan === 'pro' ? 60 : 9;

    let profile = null;
    const posts = [];

    for (const page of data.results) {
      const typeVal = page.properties['Type']?.select?.name?.toLowerCase();
      const isProfile = typeVal === 'profile';

      if (isProfile) {
        profile = extractProfile(page);
        continue;
      }

      if (posts.length >= limit) continue;

      const imageUrl = extractImageUrl(page);
      const pinned = page.properties['Pinned']?.checkbox || false;
      const mediaType = page.properties['Media Type']?.select?.name?.toLowerCase() || 'photo';
      const publishDate = formatDate(page.properties['Publish Date']?.date?.start);
      const name = page.properties['Name']?.title?.[0]?.plain_text || '';

      posts.push({
        pageId: page.id,
        name,
        imageUrl,
        publishDate,
        pinned: plan === 'pro' ? pinned : false,
        mediaType: plan === 'pro' ? mediaType : 'photo',
      });
    }

    // Pinned posts first (Pro only)
    if (plan === 'pro') {
      posts.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    return res.status(200).json({ posts, plan, profile });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch posts', details: err.message });
  }
}
