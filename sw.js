const CACHE = 'gastosapp-v1';
const ASSETS = [
  '/gastosapp/',
  '/gastosapp/index.html',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Sora:wght@300;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  // Only cache GET requests
  if(e.request.method!=='GET') return;
  // Don't cache Apps Script API calls
  if(e.request.url.includes('script.google.com')) return;
  
  e.respondWith(
    caches.match(e.request).then(cached=>{
      if(cached) return cached;
      return fetch(e.request).then(response=>{
        if(response.ok){
          const clone=response.clone();
          caches.open(CACHE).then(cache=>cache.put(e.request,clone));
        }
        return response;
      }).catch(()=>cached);
    })
  );
});
