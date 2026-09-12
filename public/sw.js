// v2: v1 stored a fresh copy of index.html for every AutoUpdateChecker poll
// (`/index.html?t=<now>`), growing without bound. Bumping the name makes
// `activate` delete that cache.
const CACHE_NAME = 'intrack-cache-v2';
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Only intercept GET, same-origin requests (excludes API calls, Supabase, CDNs)
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(self.location.origin)) return;
  if (req.url.includes('/api/')) return;

  const url = new URL(req.url);

  // The update poll asks for the network's answer and nothing else. Caching it
  // is pointless (the next poll ignores it) and, with a unique `?t=` each time,
  // filled Cache Storage on phones.
  if (url.pathname === '/index.html' || req.cache === 'no-store') return;

  // Hashed build assets are immutable — cache-first, refresh cache in background.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            // Cloned SYNCHRONOUSLY, before any other async step. caches.open()
            // is itself async, and `res` is handed back to the page (via the
            // `return res` below) the moment this .then() runs — the browser
            // can start consuming that body immediately. Deferring .clone()
            // into a nested .then() on caches.open() raced that consumption:
            // by the time it ran, res.bodyUsed was often already true, and
            // clone() throws "Response body is already used" instead of
            // caching anything — this fired on nearly every asset load.
            //
            // Never cache an HTML answer to an asset request. A Wi-Fi captive
            // portal, a carrier interstitial, or any SPA fallback can reply
            // `200 text/html` for a missing .js file. Stored here, cache-first
            // would serve that HTML as the chunk forever, and the route would
            // stay broken through every reload.
            const isHtml = (res.headers.get('content-type') || '').includes('text/html');
            const resClone = res.ok && !isHtml ? res.clone() : null;
            if (resClone) caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // SPA navigations — network-first, fall back to the cached app shell so the
  // app still opens offline instead of showing the browser's default error page.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Only a real page becomes the offline shell. Without this a 404 or a
          // 5xx error page could be stored as '/' and served to every offline open.
          const isPage = res.ok && (res.headers.get('content-type') || '').includes('text/html');
          const resClone = isPage ? res.clone() : null; // see the /assets/ branch above for why this must be synchronous
          if (resClone) caches.open(CACHE_NAME).then((cache) => cache.put('/', resClone));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Everything else same-origin — network-first, cache successful responses,
  // fall back to whatever was last cached when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.ok ? res.clone() : null; // see the /assets/ branch above for why this must be synchronous
        if (resClone) caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response('Network connection failed and asset not cached.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        });
      })
  );
});
