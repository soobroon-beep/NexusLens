// Service Worker — Nova Nexus · Lens
const CACHE = 'nn-lens-v4';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled([
        c.add('./'),
        c.add('./index.html'),
        c.add('./manifest.json'),
        c.add('./icon.png'),
      ]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo cachear assets propios del sitio; dejar pasar todo lo externo
  if (url.hostname !== self.location.hostname) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
