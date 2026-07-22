const CACHE = 'itcontrol-v7';
const ASSETS = [
  '/ITControl/',
  '/ITControl/index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
  )));
  self.clients.claim();
});
self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  if(e.request.url.includes('script.google.com')) return;
  if(e.request.url.includes('accounts.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(res=>{
        if(res.ok){const c=res.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));}
        return res;
      }).catch(()=>cached);
    })
  );
});
