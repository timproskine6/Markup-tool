// Real offline app-shell cache. The earlier version of this file (see git
// history / the project's README changelog) deliberately did NOT cache
// anything — active development meant editing app files constantly, and a
// service worker only re-checks for updates when the browser notices *this
// file's own bytes* changed, so a caching SW during that phase just meant
// Safari confidently replaying stale code. That churn is over now, so this
// restores real offline support: everything the app needs is precached at
// install time, so once you've loaded it here at least once, "Add to Home
// Screen" gives you a fully working app with zero network access — no need
// to keep a-Shell's local server running just to use it day to day.
//
// THE ONE RULE FOR SHIPPING AN UPDATE: bump CACHE_VERSION below, AND bump
// APP_VERSION in src/main.js to the exact same string. The two used to be
// one rule (just this file), but main.js now compares its own baked-in
// APP_VERSION against the active cache name to detect "a new version
// finished installing in the background, but this open tab hasn't reloaded
// to actually run it yet" — see the APP_VERSION comment in main.js for why
// that distinction matters. If these two values ever drift apart by
// accident, the symptom is a tab permanently showing itself a "there's an
// update, tap to reload" prompt even right after reloading.
const CACHE_VERSION = 'v28';
const CACHE_NAME = `sprinkler-markup-${CACHE_VERSION}`;

// Every file the app needs to boot and run fully offline. If you add a new
// src/*.js file (a new module import) or a new vendor/icon asset, add it here
// too — anything not listed here will only work offline if it happens to get
// opportunistically cached by the fetch handler's fallback below, which only
// covers files actually requested while online at least once.
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './src/main.js',
  './src/stage.js',
  './src/pdfViewer.js',
  './src/palette.js',
  './src/legend.js',
  './src/export.js',
  './src/storage.js',
  './src/symbols.js',
  './src/symbolPrefs.js',
  './src/textSearch.js',
  './src/pictureSearch.js',
  './vendor/pdf-lib.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      // Take over immediately rather than waiting for every open tab to
      // close — paired with clients.claim() in activate, this is what lets a
      // version bump take effect on the very next reload instead of needing
      // two (the classic "close every tab first" SW update gotcha).
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin requests

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      // Not precached — shouldn't normally happen for an app-shell file, but
      // covers anything added to disk without also being added to
      // PRECACHE_URLS above. Falls through to the network and caches a copy
      // for next time, so a later fully-offline reload can still find it.
      try {
        const response = await fetch(event.request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        // Truly offline and nothing cached for this request — nothing more
        // we can do; let the failure propagate like a normal network error.
        throw err;
      }
    })()
  );
});
