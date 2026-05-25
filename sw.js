// Service Worker — Nova Nexus · Lens
const CACHE = 'nn-lens-v2';

// Detectar base path automáticamente
const BASE = self.registration.scope;

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.svg',
  BASE + 'icons/icon-512.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => {
        // Cachear uno a uno para no fallar en conjunto
        return Promise.allSettled(ASSETS.map(url => c.add(url)));
      })
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
  // Dejar pasar llamadas a APIs externas (BingX, fonts, CDN)
  if (url.hostname !== self.location.hostname) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(BASE + 'index.html'));
    })
  );
});
