// FieldBook Service Worker
// Caches the app shell for offline use

// Bump this string every time you deploy new code.
// The activate handler deletes any cache with a different name, forcing
// browsers and installed PWAs to discard stale files and re-fetch everything.
const CACHE_NAME = 'fieldbook-v1.212';

// OpenStreetMap tiles the Map page has shown, kept for offline use. This cache
// is NOT versioned and survives every CACHE_NAME bump. Only tiles the user
// actually viewed are stored (OSM's tile policy forbids bulk / area
// downloads), and it is capped by deleting the oldest keys in batches.
const TILE_CACHE = 'fieldbook-tiles-v1';
const TILE_HOST = 'tile.openstreetmap.org';
const TILE_MAX = 4000;
const TILE_TRIM = 200;
const TILE_TRIM_EVERY = 25;   // check the size every this many stores

// CDN libraries (React, Babel, jsPDF, Leaflet, fonts …). Also NOT versioned:
// it survives CACHE_NAME bumps, so an update never has to download them again
// and a launch with no signal never waits on the network for them.
//  - Pinned URLs (an exact version in the path, or a hashed font file) never
//    change, so they are served cache-first.
//  - Unpinned ones (Tailwind's CDN script, the Google Fonts stylesheet) are
//    served from the cache at once and refreshed in the background.
// Anything else from another origin keeps network-first.
const CDN_CACHE = 'fieldbook-cdn-v1';
const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'cdn.tailwindcss.com',
  'fonts.googleapis.com', 'fonts.gstatic.com'];
function cdnPinned(url) {
  if (url.hostname === 'fonts.gstatic.com') return true;
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') return /@\d+\.\d+\.\d+\//.test(url.pathname);
  if (url.hostname === 'cdnjs.cloudflare.com') return /^\/ajax\/libs\/[^/]+\/\d+\.\d+(\.\d+)?\//.test(url.pathname);
  return false;
}
// A response worth keeping: a real 200, or an opaque one (a <script> without
// crossorigin can't be read, but it can be stored and served).
const keepable = (r) => r && (r.ok || r.type === 'opaque');

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

// Babel is fetched by the page only when the code cache misses — that is, on
// the first launch after an update, which may be offline. Make sure the CDN
// cache has it. Best effort: a failure here must never fail the install. Keep
// this URL identical to FB_BABEL_URL in index.html.
const BABEL_URL = 'https://unpkg.com/@babel/standalone@8.0.7/babel.min.js';

self.addEventListener('install', (event) => {
  event.waitUntil(
    // Fetch everything first so a failed download leaves nothing half-written;
    // a failed install is simply retried the next time the app is opened.
    Promise.all(APP_SHELL.map(fetchFresh)).then((responses) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return Promise.all(APP_SHELL.map((url, i) => cache.put(url, responses[i])))
          .then(() => caches.open(CDN_CACHE))
          .then((cdn) => cdn.match(BABEL_URL).then((hit) => hit || fetch(BABEL_URL, { mode: 'cors' })
            .then((r) => (r.ok ? cdn.put(BABEL_URL, r) : null))))
          .catch(() => {});
      });
    })
  );
  // Take control immediately without waiting for old SW to die
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────
// Old version caches are deleted. Builds before v1.209 kept CDN files in the
// version cache, so those are moved into CDN_CACHE first — the first launch
// after this update then has them even with no signal.
function keepCdnCopies(oldName) {
  return Promise.all([caches.open(oldName), caches.open(CDN_CACHE)]).then(([old, cdn]) =>
    old.keys().then((reqs) => Promise.all(reqs.map((req) => {
      let host;
      try { host = new URL(req.url).hostname; } catch (e) { return null; }
      if (!CDN_HOSTS.includes(host)) return null;
      return cdn.match(req).then((have) => have || old.match(req).then((r) => (keepable(r) ? cdn.put(req, r) : null)));
    })))).catch(() => {});
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      const old = cacheNames.filter((name) => name !== CACHE_NAME && name !== TILE_CACHE && name !== CDN_CACHE);
      return Promise.all(old.map((name) => keepCdnCopies(name).then(() => caches.delete(name))));
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
  // Map page base-map tiles — their own cache, before the CDN rule below so
  // they never land in the app cache.
  if (url.hostname === TILE_HOST) {
    event.respondWith(tileFirst(request));
    return;
  }
  // CDN libraries — see CDN_CACHE above.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cdnPinned(url) ? cdnFirst(request) : cdnStale(request, event));
    return;
  }
  // Other cross-origin requests — network first, fall back to cache
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

// ─── CDN libraries ───────────────────────────────────────────────────────────
// A pinned file: the cached copy if there is one (this version's cache too, for
// a copy stored before the move), else the network, kept for next time.
function cdnFirst(request) {
  return caches.open(CDN_CACHE).then((cdn) =>
    cdn.match(request).then((hit) => hit || caches.match(request)).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (keepable(response)) cdn.put(request, response.clone()).catch(() => {});
        return response;
      });
    })
  );
}
// An unpinned file: the cached copy at once and a background refresh, or the
// network when nothing is cached yet.
function cdnStale(request, event) {
  return caches.open(CDN_CACHE).then((cdn) =>
    cdn.match(request).then((hit) => hit || caches.match(request)).then((hit) => {
      const refresh = fetch(request).then((response) => {
        if (keepable(response)) return cdn.put(request, response.clone()).then(() => response);
        return response;
      });
      if (hit) {
        event.waitUntil(refresh.catch(() => {}));
        return hit;
      }
      return refresh;
    })
  );
}

// ─── Map tiles ───────────────────────────────────────────────────────────────
// Cache first, then the network. Only real CORS responses are stored: an
// opaque (no-cors) response is padded to megabytes in the browser's storage
// quota, and a quota squeeze must never put the project data at risk. The
// Map page asks for tiles with crossOrigin so they arrive as CORS.
let tileStores = 0;
function tileFirst(request) {
  return caches.open(TILE_CACHE).then((cache) =>
    cache.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'cors') {
          cache.put(request, response.clone()).then(() => {
            if (++tileStores % TILE_TRIM_EVERY === 0) trimTiles(cache);
          }).catch(() => {});
        }
        return response;
      }).catch(() => Response.error());
    })
  );
}

// Keys come back in insertion order, so the first ones are the oldest.
function trimTiles(cache) {
  return cache.keys().then((keys) => {
    if (keys.length <= TILE_MAX) return;
    const drop = keys.slice(0, Math.max(TILE_TRIM, keys.length - TILE_MAX));
    return Promise.all(drop.map((k) => cache.delete(k)));
  }).catch(() => {});
}
