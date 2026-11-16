const CACHE='isolate-pages-v2';
const FILES=['./','./index.html','./style.css','./app.js','./reading.js','./data-client.js','./collection.js','./visual-data.js','./image-tools.js','./photo-client.js','./photo-queue-client.js','./photo-outbox.js','./photo-bridge.js','./catalog.json','./icon.svg','./manifest.webmanifest'];
const IMAGE_CACHE='isolate-images-v1', OPAQUE_CACHE='isolate-images-opaque-v1';
const IMAGE_HOST=/^(m\.media-amazon\.com|images\.metahub\.space|commons\.wikimedia\.org|upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.tvmaze\.com|i\.ytimg\.com|i\.pinimg\.com|img\d*\.doubanio\.com)$/;
const imagePending=new Map(), imageQueue=[];let imageRunning=0;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('isolate-pages-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
function queuedImage(request){return new Promise((resolve,reject)=>{imageQueue.push({request,resolve,reject});pumpImages();});}
function pumpImages(){while(imageRunning<4&&imageQueue.length){const job=imageQueue.shift();imageRunning++;fetchImage(job.request).then(job.resolve,job.reject).finally(()=>{imageRunning--;pumpImages();});}}
async function fetchImage(request){
 let response;const signal=AbortSignal.any([request.signal,AbortSignal.timeout(12000)]);
 try{response=await fetch(new Request(request,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal}));}catch(error){if(signal.aborted)throw error;response=await fetch(new Request(request,{signal,referrerPolicy:'no-referrer'}));}
 if(!response.ok&&response.type!=='opaque')return response;
 const opaque=response.type==='opaque',size=Number(response.headers.get('content-length')||0);
 if(size>2000000)return response;
 try{const cache=await caches.open(opaque?OPAQUE_CACHE:IMAGE_CACHE);await cache.put(request.url,response.clone());const keys=await cache.keys(),limit=opaque?12:120;for(const key of keys.slice(0,Math.max(0,keys.length-limit)))await cache.delete(key);}catch{}
 return response;
}
async function imageResponse(request){
 for(const name of [IMAGE_CACHE,OPAQUE_CACHE]){try{const cached=await(await caches.open(name)).match(request.url);if(cached)return cached;}catch{}}
 const key=request.url;
 if(!imagePending.has(key)){const task=queuedImage(request);imagePending.set(key,task);task.finally(()=>imagePending.delete(key)).catch(()=>{});}
 return (await imagePending.get(key)).clone();
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),base=new URL(self.registration.scope);
 if(event.request.method!=='GET')return;
 const ownPreview=url.origin===base.origin&&url.pathname.startsWith(base.pathname+'photo-data/images/')&&/^images\/(tt|nm)\d{5,12}\/[a-f0-9]{24}\.webp$/.test(url.pathname.slice((base.pathname+'photo-data/').length));
 if(event.request.destination==='image'&&(url.protocol==='https:'&&IMAGE_HOST.test(url.hostname)||ownPreview)){event.respondWith(imageResponse(event.request));return;}
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
 const rel=url.pathname.slice(base.pathname.length);if(!FILES.includes('./'+rel))return;
 event.respondWith(fetch(event.request,{cache:'no-cache'}).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>{const cached=await caches.match(event.request,{ignoreSearch:true});return cached||new Response('离线资源不可用，请联网重试。',{status:503});}));
});
