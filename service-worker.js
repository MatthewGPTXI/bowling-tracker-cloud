importScripts('./version.js');
const CACHE_PREFIX = `bowling-tracker:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}v${self.BOWLING_VERSION}`;
const APP_ASSETS = [
  './',
  './index.html',
  './version.js',
  './styles.css',
  './balls.js',
  './ui.js',
  './app.js',
  './score-cards.js',
  './updates.js',
  './firebase-config.js',
  './cloud.js',
  './friend-stats.js',
  './profile.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // A new offline cache must not reuse old files from the HTTP cache.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(APP_ASSETS.map(asset => new Request(asset, { cache: 'reload' })))
  ));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys())
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'BOWLING_VERSION') {
    event.ports[0]?.postMessage({version: self.BOWLING_VERSION});
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);

  // Firebase SDK/API requests are cross-origin and should go directly to Firebase.
  if (requestUrl.origin !== self.location.origin) return;

  // Release probes must never be satisfied by an offline or stale HTTP cache.
  if (requestUrl.pathname === new URL('./build.json', self.registration.scope).pathname) {
    event.respondWith(fetch(new Request(event.request, {cache: 'no-store'})));
    return;
  }

  // Always check the network first for Firebase config so a newly pasted
  // project configuration is not trapped behind an older offline cache.
  if (requestUrl.pathname.endsWith('/firebase-config.js')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(event.request)))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.open(CACHE_NAME).then((cache) => cache.match('./index.html'));
        return Response.error();
      });
    })
  );
});
