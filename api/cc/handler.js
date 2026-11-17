// Command Center API entry point (Vercel function). All logic is in api/_cc/server.js.
import { handle } from '../_cc/server.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  // vercel.json rewrites /api/cc/<path> to this file with the path in __p (Vercel has no multi-segment file routes here).
  const raw = url.searchParams.has('__p') ? url.searchParams.get('__p') : url.pathname.replace(/^\/api\/cc\/?/, '');
  url.searchParams.delete('__p');
  const path = raw.split('/').filter(Boolean);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  let body = {};
  if (req.method === 'POST') { try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}); } catch { body = null; } }
  const ip = String(headers['x-real-ip'] || headers['x-forwarded-for'] || '').split(',')[0].trim();
  let out;
  try {
    out = await handle({ method: req.method, path, headers, body, ip, query: Object.fromEntries(url.searchParams), secure: headers['x-forwarded-proto'] !== 'http' });
  } catch (e) {
    console.error('cc api error', e && e.message);
    out = { status: 500, body: { error: 'Something went wrong on our side. Nothing was changed.' } };
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (out.cookies) res.setHeader('Set-Cookie', out.cookies);
  res.statusCode = out.status;
  res.end(JSON.stringify(out.body));
}
