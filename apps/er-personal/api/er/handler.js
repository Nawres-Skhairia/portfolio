// Personal Expense Radar API entry point (Vercel function). All logic is in api/_er/server.js.
// No request body is ever logged: the bodies are encrypted anyway, but logs stay free of them.
import { handle } from '../_er/server.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const raw = url.searchParams.has('__p') ? url.searchParams.get('__p') : url.pathname.replace(/^\/api\/er\/?/, '');
  const path = raw.split('/').filter(Boolean);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  let body = {};
  if (req.method !== 'GET') { try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { body = null; } }
  const ip = String(headers['x-real-ip'] || '').trim();
  let out;
  try {
    out = await handle({ method: req.method, path, headers, body, ip, secure: headers['x-forwarded-proto'] !== 'http' });
  } catch (e) {
    console.error('er api error', e && e.code ? e.code : 'unknown');
    out = { status: 500, body: { error: 'Something went wrong on our side. Nothing was changed.' } };
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (out.cookies) res.setHeader('Set-Cookie', out.cookies);
  res.statusCode = out.status;
  res.end(JSON.stringify(out.body));
}
