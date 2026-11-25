const CACHE_NAME = 'arupos-v1-cache-23';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './css/tokens.css',
  './css/styles.css',
  './css/animations.css',
  './js/i18n.js',
  './js/firebase.js',
  './js/app.js',
  './js/utils.js',
  './js/icons.js',
  './js/motion.js',
  './js/migration.js',
  './js/wizard.js',
  './js/store.js',
  './js/cart.js',
  './js/receipt.js',
  './js/views/pos.js',
  './js/views/products.js',
  './js/views/history.js',
  './js/views/reports.js',
  './js/views/settings.js',
];

const FIREBASE_SDK_ORIGIN = 'https://www.gstatic.com';
const FIREBASE_SDK_PREFIX = '/firebasejs/';
const FIREBASE_SDK_ASSETS = [
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js',
];

async function precacheFirebaseSdks(cache) {
  await Promise.allSettled(
    FIREBASE_SDK_ASSETS.map(async (url) => {
      const response = await fetch(new Request(url, { mode: 'cors' }));
      if (response && response.ok) {
        await cache.put(url, response.clone());
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL_ASSETS);
        await precacheFirebaseSdks(cache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === FIREBASE_SDK_ORIGIN && url.pathname.startsWith(FIREBASE_SDK_PREFIX)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            await cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(async (networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return networkResponse;
        }
        if (networkResponse && networkResponse.status >= 500) {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === 'navigate') {
            const fallback = await caches.match('./index.html');
            if (fallback) return fallback;
          }
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return Response.error();
      })
  );
});
