const CACHE_VERSION = 'devai-v1';
const RUNTIME_CACHE = 'devai-runtime-v1';
const API_CACHE = 'devai-api-v1';

self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(caches.open(CACHE_VERSION));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_VERSION && cacheName !== RUNTIME_CACHE && cacheName !== API_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          caches.open(API_CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => caches.match(request))
    );
  }
});

console.log('[ServiceWorker] Ready');
