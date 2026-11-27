const CACHE = 'keuanganku-1795767197698';
const FILE = ['./', 'index.html', 'kunci.js?v=1795767197698', 'config.js?v=1795767197698', 'manifest.webmanifest', 'ikon-192.png', 'ikon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // cache: 'no-cache' = selalu tanya GitHub dulu apakah ada versi baru (tidak memakai simpanan 10 menit browser)
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const salin = r.clone(); caches.open(CACHE).then(c => c.put(e.request, salin)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
