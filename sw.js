const CACHE = "btx-premio-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e)=>{
  e.waitUntil((async ()=>{
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if(req.method!=="GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  e.respondWith((async ()=>{
    const c = await caches.open(CACHE);
    const cached = await c.match(req, {ignoreSearch:true});
    if(cached) return cached;
    const fresh = await fetch(req);
    try{ c.put(req, fresh.clone()); }catch(_){}
    return fresh;
  })());
});
