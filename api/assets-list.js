// api/assets-list.js
// Returns all asset cards (title, preview, section, author — no sensitive data).
// Requires membership !== 'default'. Full content is gated behind asset-get.js.
//
// APPWRITE SETUP — create a second collection called "assets" in the same DB.
// Env var: APPWRITE_ASSETS_COL_ID = <your new collection $id>
//
// Attributes to create in the assets table:
//   title           String(100)   required
//   card_desc       String(50)    required
//   section         String(20)    required  (community | contributor | official)
//   background_url  String(512)   optional  default ""
//   created_by_id   String(64)    required
//   created_by_name String(128)   required
//   description     String(4096)  optional  default ""
//   mega_link       String(512)   optional  default ""
//   mega_key        String(512)   optional  default ""
//   external_links  String(2048)  optional  default "[]" (JSON array of {label,url})
//   code_block      String(8192)  optional  default ""
//   code_lang       String(64)    optional  default ""

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

function verifySession(token) {
  try {
    var parts   = token.split('.');
    var sig     = parts[1];
    var expected = crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update(parts[0]).digest('base64url');
    if (sig !== expected) return null;
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
  if (req.method !== 'GET') return res.status(405).end();

  var cookies = parseCookies(req.headers.cookie);
  var token   = cookies['nc_session'];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  var session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }
  if (session.locked) return res.status(403).json({ error: 'Account locked.' });

  var db        = getDb();
  var DB_ID     = process.env.APPWRITE_DB_ID;
  var USERS_COL = process.env.APPWRITE_COLLECTION_ID;
  var ASSETS_COL = process.env.APPWRITE_ASSETS_COL_ID;

  // Re-verify from DB to get live contributor + membership
  var userRow;
  try {
    var result = await db.listDocuments(DB_ID, USERS_COL, [
      Query.equal('discord_id', session.id),
    ]);
    if (result.total === 0) return res.status(401).json({ error: 'User not found.' });
    userRow = result.documents[0];
  } catch (err) {
    console.error('[assets-list] user lookup:', err.message);
    return res.status(500).json({ error: 'Database error.' });
  }

  if (userRow.locked) return res.status(403).json({ error: 'Account locked.' });

  // Pending members cant see the vault at all
  if (!userRow.is_admin && userRow.membership === 'default') {
    return res.status(403).json({ notVerified: true });
  }

  // Fetch all asset cards — batch paginate
  var allAssets = [];
  var offset    = 0;
  try {
    while (true) {
      var batch = await db.listDocuments(DB_ID, ASSETS_COL, [
        Query.limit(100),
        Query.offset(offset),
        Query.orderDesc('$createdAt'),
      ]);
      allAssets = allAssets.concat(batch.documents);
      if (allAssets.length >= batch.total) break;
      offset += 100;
    }
  } catch (err) {
    console.error('[assets-list] fetch:', err.message);
    return res.status(500).json({ error: 'Could not load assets.' });
  }

  // Strip to card-level data only — no sensitive fields
  var cards = allAssets.map(function(a) {
    return {
      id:             a.$id,
      title:          a.title,
      card_desc:      a.card_desc,
      section:        a.section,
      created_by_name: a.created_by_name,
      created_by_id:  a.created_by_id,
      created_at:     a.$createdAt,
    };
  });

  return res.status(200).json({
    cards: cards,
    viewer: {
      id:          userRow.discord_id,
      username:    userRow.discord_username || '',
      avatar:      userRow.discord_avatar   || '',
      membership:  userRow.membership,
      contributor: userRow.contributor  || false,
      is_admin:    userRow.is_admin     || false,
    },
  });
}
