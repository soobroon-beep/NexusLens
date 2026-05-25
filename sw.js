// Service Worker — Nova Nexus · Lens
const CACHE = 'nn-lens-v1';
const ASSETS = [
  '/NexusLens/',
  '/NexusLens/index.html',
  '/NexusLens/manifest.json',
  '/NexusLens/icons/icon-192.svg',
  '/NexusLens/icons/icon-512.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Solo cachear recursos del mismo origen; dejar pasar las llamadas a BingX/API
  const url = new URL(e.request.url);
  if (url.hostname !== self.location.hostname) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type !== 'opaque') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('/NexusLens/index.html')))
  );
});
