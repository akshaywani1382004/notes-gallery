/* Notes Gallery service worker — offline app shell.
   Network-first for same-origin GETs (so updates land immediately when online),
   with a cache fallback so the app works offline. Bump CACHE on each release. */
const CACHE = 'notes-gallery-v22';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    './',
    './index.html',
  ]).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // don't touch cross-origin
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (_) {
      const cached = await caches.match(req);
      if (cached) return cached;
      // last resort: serve the app shell for navigations
      if (req.mode === 'navigate') { const shell = await caches.match('./index.html'); if (shell) return shell; }
      throw _;
    }
  })());
});
