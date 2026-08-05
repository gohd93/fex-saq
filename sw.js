/* Fellowship Examination SAQ — service worker
   The shell is precached so the app opens instantly and offline.
   Question and image shards are NOT precached: together they are well
   over 100 MB, which would stall installation and blow past the browser
   storage a phone will grant. They are cached individually the first
   time a paper is opened, so the papers a candidate actually uses
   become available offline and the rest cost nothing. */
const VERSION='fex-saq-v1.0.0';
const SHELL_CACHE=VERSION+'-shell';
const DATA_CACHE=VERSION+'-data';
const ASSET_CACHE=VERSION+'-assets';
const SHELL=[
  './','./index.html','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
  './icons/maskable-192.png','./icons/maskable-512.png',
  './icons/apple-touch-icon.png','./icons/favicon-32.png'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);
    // addAll fails the whole install if any one file 404s, so add each
    // separately and let the shell install even if an icon is missing.
    await Promise.all(SHELL.map(url=>cache.add(url).catch(()=>{})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>!k.startsWith(VERSION)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request,cacheName){
  const cache=await caches.open(cacheName);
  const hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request);
  if(response&&response.ok)cache.put(request,response.clone());
  return response;
}

// The document is served network-first so a new release is picked up on
// the next launch, with the cached shell as the offline fallback.
async function networkFirst(request){
  const cache=await caches.open(SHELL_CACHE);
  try{
    const response=await fetch(request);
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(e){
    return (await cache.match(request))||(await cache.match('./index.html'))||Response.error();
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==='navigate'||url.pathname.endsWith('/')||url.pathname.endsWith('index.html')){
    event.respondWith(networkFirst(request));return;
  }
  if(url.pathname.includes('/saq-data/')){event.respondWith(cacheFirst(request,DATA_CACHE));return}
  if(url.pathname.includes('/saq-assets/')){event.respondWith(cacheFirst(request,ASSET_CACHE));return}
  event.respondWith(cacheFirst(request,SHELL_CACHE));
});

// Shards fetched before this worker took control never passed through
// the fetch handler, so the page hands their URLs over once we are
// active. Each is filed in the cache its path belongs to.
self.addEventListener('message',event=>{
  const data=event.data||{};
  if(data.type!=='cache-urls'||!Array.isArray(data.urls))return;
  event.waitUntil((async()=>{
    const dataCache=await caches.open(DATA_CACHE);
    const assetCache=await caches.open(ASSET_CACHE);
    await Promise.all(data.urls.map(async url=>{
      const target=url.includes('/saq-data/')?dataCache:url.includes('/saq-assets/')?assetCache:null;
      if(!target)return;
      if(await target.match(url))return;
      await target.add(url).catch(()=>{});
    }));
    const clients=await self.clients.matchAll();
    clients.forEach(c=>c.postMessage({type:'cache-urls-done',count:data.urls.length}));
  })());
});
