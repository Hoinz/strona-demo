const CACHE='pawsome-v4';
const ASSETS=['/','index.html','usluga.html','umow-wizyte.html','shared.css','booking.css','booking.js','site-content.js','firebase-config.js','fonts/dmsans-latin.woff2','fonts/dmsans-latin-ext.woff2','fonts/playfair-latin.woff2','fonts/playfair-latin-ext.woff2','fonts/playfair-italic-latin.woff2','fonts/playfair-italic-latin-ext.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=e.request.url;if(u.includes('firestore.googleapis.com')||u.includes('googleapis.com/identitytoolkit')||u.includes('gstatic.com/firebasejs')){e.respondWith(fetch(e.request));return}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
