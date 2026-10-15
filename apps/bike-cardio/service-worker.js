'use strict';
// The Pages build versions CACHE from all deployed assets.
const CACHE = 'bike-cardio-shell-source';
const ENTRY = './';
const FILES = [ENTRY, './manifest.webmanifest', './icon-32.png', './icon-192.png', './icon-512.png', './apple-touch-icon-180.png'];
const PAGE_PATHS = ['./', './index.html', './sprint-intervals', './sprint-intervals.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bike-cardio-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const path = new URL(event.request.url).pathname;
  const page = event.request.mode === 'navigate' && PAGE_PATHS.some(file => new URL(file, self.registration.scope).pathname === path);
  const known = FILES.some(file => new URL(file, self.registration.scope).pathname === path);
  if (!page && !known) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(page ? new URL(ENTRY, self.registration.scope).href : event.request, {ignoreSearch:true});
    return cached || fetch(event.request);
  }));
});

/* app-update-worker:start */
/* app-update-worker:end */
