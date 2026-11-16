// Portfolio site check (PORT-27). Plain Node, no packages, no secrets, no network.
// Run from the repository root: node .github/scripts/site-check.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SITE = 'https://nawres-skhairia.vercel.app';
const MAX_BYTES = 25 * 1024 * 1024;
const problems = [];
const fail = (file, msg) => problems.push(`${file}: ${msg}`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const rel = (p) => relative(ROOT, p);

// 1. Search Console tag
const home = join(ROOT, 'index.html');
if (!existsSync(home) || !/<meta\s+name="google-site-verification"\s+content="[^"]+"/i.test(readFileSync(home, 'utf8'))) {
  fail('index.html', 'Google Search Console tag (google-site-verification) is missing');
}

// 2. File size
for (const f of files) {
  const size = statSync(f).size;
  if (size > MAX_BYTES) fail(rel(f), `file is ${(size / 1048576).toFixed(1)} MB, over the 25 MB limit`);
}

// 3. vercel.json
const vj = join(ROOT, 'vercel.json');
if (existsSync(vj)) { try { JSON.parse(readFileSync(vj, 'utf8')); } catch (e) { fail('vercel.json', `not valid JSON (${e.message})`); } }

// Resolve a site address to a file in the repository
function exists(fromFile, url) {
  let path = url.split('#')[0].split('?')[0];
  if (!path) return true; // same-page anchor
  path = decodeURIComponent(path);
  let target = path.startsWith('/') ? join(ROOT, path) : join(dirname(fromFile), path);
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  return existsSync(target);
}
const isExternal = (u) => /^(https?:)?\/\//i.test(u);
const hostOf = (u) => { try { return new URL(u, SITE).hostname; } catch { return ''; } };
const ownSite = (u) => hostOf(u) === new URL(SITE).hostname;

// 4. HTML pages: outside loads and broken internal links
const attr = /<(script|img|link|source|iframe|a|video|audio)\b[^>]*?\s(src|href|srcset)\s*=\s*["']([^"']*)["'][^>]*>/gi;
for (const f of files.filter((p) => extname(p) === '.html')) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(attr)) {
    const tag = m[1].toLowerCase();
    let url = m[3].trim();
    if (!url || url.includes('${') || /^(mailto:|tel:|data:|javascript:|#)/i.test(url)) continue;
    if (m[2].toLowerCase() === 'srcset') url = url.split(/\s+/)[0];
    if (isExternal(url) && !ownSite(url)) {
      // A plain link loads nothing until clicked (privacy page must link to Vercel and the regulator); only insecure http links fail.
      if (tag === 'a') { if (/^http:/i.test(url)) fail(rel(f), `insecure http link: ${url}`); }
      else fail(rel(f), `loads a file from another website: ${url}`);
      continue;
    }
    const local = isExternal(url) ? new URL(url, SITE).pathname : url;
    if (!exists(f, local)) fail(rel(f), `points to a missing file: ${url}`);
  }
}

// 5. CSS files: outside loads (fonts, images) and missing files
for (const f of files.filter((p) => extname(p) === '.css')) {
  const css = readFileSync(f, 'utf8');
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) {
    const url = (m[1] || m[2]).trim();
    if (/^(data:|#)/i.test(url)) continue;
    if (isExternal(url) && !ownSite(url)) { fail(rel(f), `loads a file from another website: ${url}`); continue; }
    if (!exists(f, isExternal(url) ? new URL(url, SITE).pathname : url)) fail(rel(f), `points to a missing file: ${url}`);
  }
}

// 6. Sitemap addresses
const sm = join(ROOT, 'sitemap.xml');
if (existsSync(sm)) {
  for (const m of readFileSync(sm, 'utf8').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    const u = m[1];
    if (!ownSite(u)) { fail('sitemap.xml', `address is not on ${SITE}: ${u}`); continue; }
    if (!exists(join(ROOT, 'index.html'), new URL(u).pathname)) fail('sitemap.xml', `address has no page: ${u}`);
  }
}

if (problems.length) {
  console.log(`Site check found ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`Site check passed: ${files.length} files checked.`);
