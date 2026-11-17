// Local test server for Command Center with accounts: static files plus /api/cc on one address.
// CC_DATABASE_URL=... CC_DATABASE_SSL=off CC_SESSION_SECRET=... CC_PREVIEW_MAILBOX=1 node tests/cc-dev-server.mjs 8770
import http from 'node:http';
process.env.CC_ENV ||= 'preview';
process.env.CC_SESSION_SECRET ||= 'local-dev-only-secret-'.padEnd(48, 'x');
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from '../api/cc/handler.js';
const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/cc/')) {
    let raw = ''; for await (const c of req) raw += c;
    req.body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : {};
    req.headers['x-forwarded-proto'] = 'http';
    return handler(req, res);
  }
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (p.endsWith('/')) p += 'index.html';
  try { const body = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.argv[2] || 8770));
