// api/me.js
// Returns the current authenticated user's safe data.
// Also performs a live IP check — if the IP in the session
// doesn't match the current request IP, the account is locked
// and no user data is returned. This is the page-load check.

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

/* ── Session verification ───────────────────────────── */
function verifySession(token) {
  try {
    const [payload, sig] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/* ── Cookie parser ───────────────────────────────────── */
function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...rest] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(rest.join('='))];
    })
  );
}

/* ── IP extraction ───────────────────────────────────── */
function getIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/* ── Appwrite client ─────────────────────────────────── */
function getDb() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

/* ── Main handler ─────────────────────────────────────── */
export default async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token   = cookies['nc_session'];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const session = verifySession(token);
  if (!session) {
    // Clear invalid cookie
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  // Already locked in session — return locked immediately, no DB call
  if (session.locked) {
    return res.status(200).json({ locked: true });
  }

  // ── Live IP check on every page load ─────────────────
  const currentIp = getIp(req);

  // If session IP differs from current, check against DB original_ip
  if (session.ip !== currentIp && session.ip !== 'unknown') {
    // Lock the account in the DB
    try {
      const db   = getDb();
      const DB   = process.env.APPWRITE_DB_ID;
      const COLL = process.env.APPWRITE_COLLECTION_ID;

      const existing = await db.listDocuments(DB, COLL, [
        Query.equal('discord_id', session.id),
      ]);

      if (existing.total > 0) {
        const doc = existing.documents[0];
        if (!doc.locked) {
          await db.updateDocument(DB, COLL, doc.$id, {
            last_ip: currentIp,
            locked:  true,
          });
          console.warn(
            `[me] IP drift detected for ${session.username}. ` +
            `session=${session.ip} current=${currentIp} — LOCKED`
          );
        }
      }
    } catch (err) {
      console.error('[me] Lock update error:', err.message);
    }

    // Clear session cookie and return locked — expose nothing
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(200).json({ locked: true });
  }

  // ── All good — return safe user data ─────────────────
  return res.status(200).json({
    id:       session.id,
    username: session.username,
    avatar:   session.avatar,
    locked:   false,
  });
}
