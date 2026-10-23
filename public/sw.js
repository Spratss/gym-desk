// Gym Desk service worker: keeps the app on the phone so it opens with no signal.
// Online, the newest version is always fetched first; the saved copy is only used when the network
// fails or takes longer than a few seconds. API calls always go to the network (the app queues changes itself).
const CACHE = 'gymdesk-shell-v6';
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

function save(req, res) {
  if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
}
function networkFirst(req, cacheKey) {
  const net = fetch(req).then((res) => save(cacheKey || req, res));
  const slow = new Promise((resolve) => setTimeout(resolve, 4000));
  // Use the network unless it fails or is slow; then fall back to the saved copy (and let the fetch finish in the background).
  return Promise.race([net, slow.then(() => caches.match(cacheKey || req).then((hit) => hit || net))])
    .catch(() => caches.match(cacheKey || req))
    .then((res) => res || net);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (e.request.mode === 'navigate') { e.respondWith(networkFirst(e.request, '/')); return; }
  if (/\.(woff2|png|svg)$/.test(url.pathname)) {
    // Fonts and icons never change: saved copy first.
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => save(e.request, res))));
    return;
  }
  e.respondWith(networkFirst(e.request));
});
