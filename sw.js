// ═══════════════════════════════════════════════════════════
// Nova Nexus · Lens — Service Worker con proxy local CORS
// Las peticiones a BingX pasan por el SW que no tiene CORS
// ═══════════════════════════════════════════════════════════
const CACHE = 'nn-lens-v3';
const BINGX = 'https://open-api.bingx.com';

// Assets a cachear para modo offline
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.png'
];

// ── INSTALL ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH — el corazón del proxy local ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. Interceptar llamadas a /openApi/* → redirigir a BingX real
  if (url.pathname.startsWith('/openApi/')) {
    e.respondWith(fetchBingX(e.request, url));
    return;
  }

  // 2. Assets locales: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ── Reenvío a BingX sin restricciones CORS ──
async function fetchBingX(req, url) {
  // Construir URL real de BingX
  const bingxUrl = BINGX + url.pathname + url.search;

  // Obtener el API key del header original
  const apiKey = req.headers.get('X-BX-APIKEY') || '';

  try {
    const res = await fetch(bingxUrl, {
      method: 'GET',
      headers: {
        'X-BX-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
      // SW no tiene restricciones CORS — puede hacer fetch a cualquier origen
    });

    const data = await res.text();

    return new Response(data, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ code: -1, msg: 'SW fetch error: ' + err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
