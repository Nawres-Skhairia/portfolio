// Expense Radar offline support. Only this app's own files are kept, never any server answer:
// your money stays in the page's own storage, not in this cache.
const CACHE = 'er-v1';
const FILES = ['./', 'index.html', 'app.js', 'engine.js', 'seed.js', 'style.css', 'er-theme.js', 'manifest.webmanifest',
  'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2', 'fonts/jetbrains-mono-latin-500-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', '/favicon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('er-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope) && url.pathname !== '/favicon.svg') return;
  // Network first, so a new version shows at once; the saved copy is used only without a connection.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
