const MAP_CACHE_VERSION = 'mks-map-cache-v1';
const STATIC_MAP_CACHE_VERSION = 'mks-map-static-v1';
const MAX_TILE_CACHE_ENTRIES = 900;

const TILE_HOST_RE = /^(mt\d+\.google\.com|mts\d+\.google\.com|khms\d+\.google\.com)$/i;
const STATIC_MAP_PATH_RE = /^\/(?:map-worker\.js|data\/(?:route-shapes\/.*\.json|.*(?:shape|stops).*\.json))$/i;
const TILE_PROXY_RE = /^\/mks-map-tile\/google\/(\d+)\/(\d+)\/(\d+)\.png$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('mks-map-') && key !== MAP_CACHE_VERSION && key !== STATIC_MAP_CACHE_VERSION)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((request) => cache.delete(request)));
}

async function cacheTileRequest(request) {
  const cache = await caches.open(MAP_CACHE_VERSION);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).then(() => trimCache(MAP_CACHE_VERSION, MAX_TILE_CACHE_ENTRIES));
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

async function cacheProxiedGoogleTile(request, url) {
  const match = TILE_PROXY_RE.exec(url.pathname);
  if (!match) return fetch(request);

  const [, z, x, y] = match;
  const lyrs = url.searchParams.get('lyrs') || 'm';
  const hl = url.searchParams.get('hl') || 'pl';
  const gl = url.searchParams.get('gl') || 'PL';
  const googleUrl = `https://mt1.google.com/vt/lyrs=${encodeURIComponent(lyrs)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&z=${encodeURIComponent(z)}`;
  const cache = await caches.open(MAP_CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) {
    fetch(googleUrl, { mode: 'no-cors' })
      .then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          return cache.put(request, response.clone()).then(() => trimCache(MAP_CACHE_VERSION, MAX_TILE_CACHE_ENTRIES));
        }
      })
      .catch(() => {});
    return cached;
  }

  const response = await fetch(googleUrl, { mode: 'no-cors' });
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    await trimCache(MAP_CACHE_VERSION, MAX_TILE_CACHE_ENTRIES);
  }
  return response;
}

async function cacheStaticMapRequest(request) {
  const cache = await caches.open(STATIC_MAP_CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && TILE_PROXY_RE.test(url.pathname)) {
    event.respondWith(cacheProxiedGoogleTile(event.request, url));
    return;
  }

  if (TILE_HOST_RE.test(url.hostname) && url.pathname === '/vt') {
    event.respondWith(cacheTileRequest(event.request));
    return;
  }

  if (url.origin === self.location.origin && STATIC_MAP_PATH_RE.test(url.pathname)) {
    event.respondWith(cacheStaticMapRequest(event.request));
  }
});
