// App-shell cache so AlfaTrack opens offline once installed. Bump CACHE when shipping new files.
const CACHE = 'alfatrack-v12';
const SHELL = ['./', './index.html', './styles.css?v=12', './core.js?v=12', './sound.js?v=12', './app.js?v=12', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first with 5s timeout (never hangs on flaky mobile 4G), cache fallback when offline. Never cache /api/*.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
  e.respondWith(
    fetch(e.request, controller ? { cache: 'no-store', signal: controller.signal } : { cache: 'no-store' }).then((r) => {
      if (timer) clearTimeout(timer);
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => {
      if (timer) clearTimeout(timer);
      return caches.match(e.request).then((r) => r || caches.match('./index.html'));
    })
  );
});
