// FieldBook Service Worker
// Caches the app shell for offline use

// Bump this string every time you deploy new code.
// The activate handler deletes any cache with a different name, forcing
// browsers and installed PWAs to discard stale files and re-fetch everything.
const CACHE_NAME = 'fieldbook-v11';

// Core app shell files to pre-cache on install
const APP_SHELL = [
  './',
  './index.html',
  './sketch.js',
  './manifest.json',
  './icon.svg',
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
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
