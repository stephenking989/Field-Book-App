// FieldBook Service Worker
// Caches the app shell for offline use

// Bump this string every time you deploy new code.
// The activate handler deletes any cache with a different name, forcing
// browsers and installed PWAs to discard stale files and re-fetch everything.
const CACHE_NAME = 'fieldbook-beta-v1.188.0';

// Core app shell files to pre-cache on install
const APP_SHELL = [
  './',
  './index.html',
  './brand.js',
  './sketch.js',
  './geo.js',
  './geoid-ns.js',
  './gnss.js',
  './print.js',
  './schedule.js',
  './manifest.json',
  './icon.svg',
];

// ─── Install ─────────────────────────────────────────────────────────────────
// Every shell file is fetched fresh, past the browser's HTTP cache and the
// GitHub Pages CDN — both keep files for 10 minutes. cache.addAll() reads
// through them, so a phone that updated just after a deploy could store the
// PREVIOUS version's index.html under the new cache name; cache-first then
// served that stale copy until the next bump, however often the app was
// restarted. The ?v= query makes each version's files a URL nothing has cached.
function fetchFresh(url) {
  return fetch(`${url}?v=${CACHE_NAME}`, { cache: 'reload' }).then((response) => {
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return response;
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Fetch everything first so a failed download leaves nothing half-written;
    // a failed install is simply retried the next time the app is opened.
    Promise.all(APP_SHELL.map(fetchFresh)).then((responses) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return Promise.all(APP_SHELL.map((url, i) => cache.put(url, responses[i])));
      });
    })
  );
  // Take control immediately without waiting for old SW to die
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Satellite map tiles (GNSS Obs page) go straight to the network and are
  // never cached: every station asks for different tiles, so caching them
  // would only grow the cache. The captured image is stored with the page.
  if (url.hostname === 'server.arcgisonline.com') return;
  // For CDN requests (React, Tailwind, etc.) — network first, fall back to cache
  if (url.origin !== location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a copy of the CDN resource
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // For local app shell files — cache first, fall back to network
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});
