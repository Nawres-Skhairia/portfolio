// Local test server for the private Expense Radar: the built site (apps/er-personal/public) with the same
// headers as its vercel.json, plus /api/er. Throwaway database only, never real figures.
// ER_DATABASE_URL=... ER_DATABASE_SSL=off node tests/er-dev-server.mjs 8790
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const PORT = Number(process.argv[2] || 8790);
process.env.ER_PUBLIC_ORIGIN ||= 'http://localhost:' + PORT;
process.env.ER_SESSION_SECRET ||= 'local-dev-only-secret-'.padEnd(48, 'x');
process.env.ER_SETUP_CODE ||= 'local test setup code sentence';
const { default: handler } = await import('../apps/er-personal/api/er/handler.js');
const APP = new URL('../apps/er-personal/', import.meta.url).pathname;
const ROOT = APP + 'public';
const conf = JSON.parse(await readFile(APP + 'vercel.json', 'utf8'));
const HEADERS = Object.fromEntries(conf.headers[0].headers.map(h => [h.key, h.value]));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  if (req.url.startsWith('/api/er/')) {
    let raw = ''; for await (const c of req) raw += c;
    req.body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : {};
    req.headers['x-forwarded-proto'] = 'http'; req.headers['x-real-ip'] = req.headers['x-test-ip'] || '127.0.0.1';
    return handler(req, res);
  }
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html';
  try { const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(PORT);
