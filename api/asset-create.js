// api/asset-create.js
// Creates a new asset. Section-based permission check.
// mega_link must be a mega.nz URL.
// mega_key must start with nexuscollective_

import { Client, Databases, ID, Query } from 'node-appwrite';
import crypto from 'crypto';

var TIER_RANK = { default: 0, member: 1, trusted: 2, highly_trusted: 3, mommys_favorite: 4 };

function atLeast(mem, req) {
  return (TIER_RANK[mem] || 0) >= (TIER_RANK[req] || 0);
}

function canPost(user, section) {
  if (user.is_admin || user.membership === 'mommys_favorite') return true;
  switch (section) {
    case 'community':
      return atLeast(user.membership, 'highly_trusted') || user.contributor;
    case 'contributor':
      return user.contributor === true;
    case 'official':
      return false; // only admin/mommys_fav (caught above)
    default:
      return false;
  }
}

function verifySession(token) {
  try {
    var parts    = token.split('.');
    var expected = crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update(parts[0]).digest('base64url');
    if (parts[1] !== expected) return null;
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch (e) { return null; }
}

function parseCookies(header) {
  return Object.fromEntries(
    (header || '').split(';').map(function(c) {
      var p = c.trim().split('=');
      return [p[0].trim(), decodeURIComponent(p.slice(1).join('='))];
    })
  );
}

function getDb() {
  return new Databases(new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }
  if (session.locked) return res.status(403).json({ error: 'Account locked.' });

  var body = req.body || {};
  var section        = (body.section || '').trim();
  var title          = (body.title || '').trim();
  var card_desc      = (body.card_desc || '').trim();
  var description    = (body.description || '').trim();
  var mega_link      = (body.mega_link || '').trim();
  var mega_key       = (body.mega_key || '').trim();
  var external_links = body.external_links || [];
  var code_block     = (body.code_block || '').trim();

  // Required field validation
  if (!['community', 'contributor', 'official'].includes(section)) {
    return res.status(400).json({ error: 'Invalid section.' });
  }
  if (!title || title.length > 100) {
    return res.status(400).json({ error: 'Title is required and must be under 100 characters.' });
  }
  if (!card_desc || card_desc.length > 50) {
    return res.status(400).json({ error: 'Card description is required and must be under 50 characters.' });
  }
  if (description.length > 4096) {
    return res.status(400).json({ error: 'Description too long (max 4096 characters).' });
  }
  if (mega_link && !mega_link.startsWith('https://mega.nz/')) {
    return res.status(400).json({ error: 'Download link must be a mega.nz URL.' });
  }
  if (mega_key && !mega_key.startsWith('nexuscollective_')) {
    return res.status(400).json({ error: 'Encryption key must start with nexuscollective_' });
  }
  if (!Array.isArray(external_links) || external_links.length > 6) {
    return res.status(400).json({ error: 'External links: max 6.' });
  }

  // Sanitize external links — each must be {label, url} with valid URL
  var cleanLinks = [];
  for (var i = 0; i < external_links.length; i++) {
    var link = external_links[i];
    if (!link || !link.url) continue;
    var url = (link.url || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return res.status(400).json({ error: 'External link #' + (i + 1) + ' is not a valid URL.' });
    }
    cleanLinks.push({ label: (link.label || '').trim().slice(0, 80) || url, url: url });
  }

  var db         = getDb();
  var DB_ID      = process.env.APPWRITE_DB_ID;
  var USERS_COL  = process.env.APPWRITE_COLLECTION_ID;
  var ASSETS_COL = process.env.APPWRITE_ASSETS_COL_ID;

  // Re-verify user from DB
  var userRow;
  try {
    var result = await db.listDocuments(DB_ID, USERS_COL, [
      Query.equal('discord_id', session.id),
    ]);
    if (result.total === 0) return res.status(401).json({ error: 'User not found.' });
    userRow = result.documents[0];
  } catch (err) {
    return res.status(500).json({ error: 'Database error.' });
  }

  if (userRow.locked) return res.status(403).json({ error: 'Account locked.' });

  var poster = {
    id:          userRow.discord_id,
    membership:  userRow.membership,
    contributor: userRow.contributor || false,
    is_admin:    userRow.is_admin    || false,
  };

  if (!canPost(poster, section)) {
    return res.status(403).json({ error: 'You do not have permission to post in this section.' });
  }

  // Create the document
  try {
    var doc = await db.createDocument(DB_ID, ASSETS_COL, ID.unique(), {
      title:          title,
      card_desc:      card_desc,
      section:        section,
      created_by_id:  userRow.discord_id,
      created_by_name: userRow.discord_username,
      description:    description,
      mega_link:      mega_link,
      mega_key:       mega_key,
      external_links: JSON.stringify(cleanLinks),
      code_block:     code_block,
    });

    console.log('[asset-create] ' + userRow.discord_username + ' posted "' + title + '" in ' + section);

    return res.status(201).json({ id: doc.$id, ok: true });
  } catch (err) {
    console.error('[asset-create] write failed:', err.message);
    return res.status(500).json({ error: 'Failed to create asset.' });
  }
}
