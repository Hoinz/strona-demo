const CACHE='pawsome-v1';
const ASSETS=['/','index.html','badania-profilaktyczne.html','stomatologia.html','chirurgia.html','diagnostyka.html','szczepienia.html','plany-zywieniowe.html','shared.css','fonts/dmsans-latin.woff2','fonts/dmsans-latin-ext.woff2','fonts/playfair-latin.woff2','fonts/playfair-latin-ext.woff2','fonts/playfair-italic-latin.woff2','fonts/playfair-italic-latin-ext.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});