// api/logout.js
// Clears the session cookie.

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('Set-Cookie', 'nc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  return res.status(200).json({ ok: true });
}
