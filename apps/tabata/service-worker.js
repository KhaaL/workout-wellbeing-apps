/* This app's offline cache never includes workout backups or cloud requests. */
const CACHE = 'tabata-shell-source';
const SHELL = ['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('tabata-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(request))||(await cache.match('./index.html'))||fetch(request)));
  }else if(SHELL.some(asset=>new URL(asset,self.registration.scope).href===url.href)){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(request))||fetch(request)));
  }
});
/* app-update-worker:start */
/* app-update-worker:end */
