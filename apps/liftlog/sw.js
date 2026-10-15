/* Offline app shell only; workout data and cloud requests are never cached.
   The build versions CACHE from all deployed assets. Updates wait for the
   app's explicit update preparation handshake so a workout is not interrupted. */

const CACHE = 'liftlog-shell-source';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('liftlog-shell-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  /* Anything off-origin is the user's own storage bucket. Never cached, never
     touched — those requests are signed and go straight through. */
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate'){
    event.respondWith(cachedDocument(req));
    // The waiting worker owns the next version. Never replace this version’s
    // cached HTML while an update is waiting.
    return;
  }
  /* The manifest is network-first, unlike every other sub-resource here.
     Chrome re-reads it to decide whether the installed app needs updating —
     its icon, its name, the status bar colour — so serving a stale copy does
     not cost a stale pixel, it silently pins the installed app to whatever it
     was built with. It is a few hundred bytes and it falls back to the cache
     offline, so there is nothing to win by caching it first. */
  if (new URL(req.url).pathname.endsWith('/manifest.webmanifest')){
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || Response.error()))
    );
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

/* Serves the cached document immediately so an offline launch is instant. */
function cachedDocument(req){
  return caches.open(CACHE).then(cache =>
    cache.match(req)
      .then(hit => hit || cache.match('./index.html'))
      .then(hit => hit || fetch(req)));
}


/* app-update-worker:start */
/* app-update-worker:end */
