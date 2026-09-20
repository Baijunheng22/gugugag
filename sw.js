const CACHE='voiceledger-0.3-beta';
const ASSETS=['./','./index.html','./styles.css?v=0.3','./app.js?v=0.3','./manifest.webmanifest','./icons/icon-192-v03.png','./icons/icon-512-v03.png','./icons/apple-touch-icon-v03.png','./icons/favicon-v03.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url); if(url.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;}).catch(()=>caches.match(e.request).then(x=>x||caches.match('./index.html'))));
});
