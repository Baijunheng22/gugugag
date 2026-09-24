const CACHE='voiceledger-0.9-beta';
const ASSETS=['./','./index.html','./styles.css?v=0.9','./app.js?v=0.9','./manifest.webmanifest','./icon-192.png?v=0.9','./icon-512.png?v=0.9','./apple-touch-icon.png?v=0.9','./favicon.png?v=0.9'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url); if(url.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;}).catch(()=>caches.match(e.request).then(x=>x||caches.match('./index.html'))));
});
