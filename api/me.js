// api/me.js
// Session check + live IP drift detection.
// Uses Databases (not TablesDB) with correct positional args.

import { Client, Databases, Query } from 'node-appwrite';
import crypto from 'crypto';

function verifySession(token) {
  try {
    const [payload, sig] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...rest] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(rest.join('='))];
    })
  );
}

function getIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getDb() {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);
  return new Databases(client);
}

export default async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token   = cookies['nc_session'];

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  const session = verifySession(token);
  if (!session) {
    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(401).json({ error: 'Invalid session.' });
  }

  if (session.locked) return res.status(200).json({ locked: true });

  // Live IP check on every page load
  const currentIp = getIp(req);

  if (session.ip !== currentIp && session.ip !== 'unknown' && currentIp !== 'unknown') {
    try {
      const db     = getDb();
      const DB_ID  = process.env.APPWRITE_DB_ID;
      const COL_ID = process.env.APPWRITE_COLLECTION_ID;

      const result = await db.listDocuments(DB_ID, COL_ID, [
        Query.equal('discord_id', session.id),
      ]);

      if (result.total > 0 && !result.documents[0].locked) {
        await db.updateDocument(DB_ID, COL_ID, result.documents[0].$id, {
          last_ip: currentIp,
          locked:  true,
        });
        console.warn(`[me] IP drift! ${session.username} session=${session.ip} current=${currentIp} LOCKED`);
      }
    } catch (err) {
      console.error('[me] Lock update failed:', err.message);
    }

    res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0');
    return res.status(200).json({ locked: true });
  }

  return res.status(200).json({
    id:       session.id,
    username: session.username,
    avatar:   session.avatar,
    locked:   false,
  });
}
