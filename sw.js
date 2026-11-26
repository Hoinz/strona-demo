const CACHE = 'pawsome-v7';
const ASSETS = ['./', 'index.html', 'umow-wizyte.html', 'badania-profilaktyczne.html', 'szczepienia.html', 'stomatologia.html', 'diagnostyka.html', 'chirurgia.html', 'plany-zywieniowe.html', 'shared.css', 'service.css', 'booking.css', 'booking.js', 'services.js', 'firebase-config.js', 'logo.png', 'fonts/dmsans-latin.woff2', 'fonts/dmsans-latin-ext.woff2', 'fonts/playfair-latin.woff2', 'fonts/playfair-latin-ext.woff2', 'fonts/playfair-italic-latin.woff2', 'fonts/playfair-italic-latin-ext.woff2'];
const CACHE_FIRST = /\.(woff2|png|jpe?g|webp|svg|ico)$/;
const NOT_CACHED = /\/admin\.(html|js|css)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || NOT_CACHED.test(url.pathname)) return;

// Query strings such as umow-wizyte.html?service=… share one cache entry.
  const key = url.pathname;
  e.respondWith(caches.open(CACHE).then(cache => {
    const fromNetwork = () => fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (CACHE_FIRST.test(key)) {
      return cache.match(key).then(hit => hit || fromNetwork());
    }
    return fromNetwork().catch(() => cache.match(key).then(hit => hit || Response.error()));
  }));
});
