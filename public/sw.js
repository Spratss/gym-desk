// Gym Desk service worker: keeps the app shell on the phone so it opens with no signal.
// API calls always go to the network; the app queues changes itself while offline.
const CACHE = 'gymdesk-shell-v4';
const SHELL = [
  '/', '/styles.css', '/app.js', '/food.js', '/coach.js', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png',
  '/fonts/barlow-latin-400-normal.woff2', '/fonts/barlow-latin-500-normal.woff2', '/fonts/barlow-latin-600-normal.woff2', '/fonts/barlow-latin-700-normal.woff2',
  '/fonts/big-shoulders-display-latin-700-normal.woff2', '/fonts/big-shoulders-display-latin-800-normal.woff2', '/fonts/big-shoulders-display-latin-900-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (e.request.mode === 'navigate') {
    // Network first so updates show straight away; fall back to the cached shell offline.
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  // Everything else: serve from cache, refresh in the background.
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
