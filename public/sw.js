const CACHE='isolate-pages-v2';
const FILES=['./','./index.html','./style.css','./app.js','./reading.js','./data-client.js','./collection.js','./visual-data.js','./image-tools.js','./photo-client.js','./photo-queue-client.js','./photo-outbox.js','./photo-bridge.js','./photo-progress.js','./catalog.json','./icon.svg','./manifest.webmanifest'];
const IMAGE_CACHE='isolate-images-v1', OPAQUE_CACHE='isolate-images-opaque-v1';
const IMAGE_LIMIT=1000, OPAQUE_LIMIT=250;
const IMAGE_HOST=/^(m\.media-amazon\.com|images\.metahub\.space|commons\.wikimedia\.org|upload\.wikimedia\.org|thumb\.wikimedia\.org|static\.tvmaze\.com|i\.ytimg\.com|i\.pinimg\.com|img\d*\.doubanio\.com)$/;
const imagePending=new Map(), imageQueue=[], noCorsHosts=new Set();let imageRunning=0;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('isolate-pages-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{
 const data=event.data;
 if(data?.type==='evict-image'&&typeof data.url==='string'){
  event.waitUntil(Promise.all([IMAGE_CACHE,OPAQUE_CACHE].map(async name=>{try{const cache=await caches.open(name);await cache.delete(data.url);}catch{}})));
 }
});
function queuedImage(request){return new Promise((resolve,reject)=>{imageQueue.push({request,resolve,reject});pumpImages();});}
function pumpImages(){while(imageRunning<4&&imageQueue.length){const job=imageQueue.shift();imageRunning++;fetchImage(job.request).then(job.resolve,job.reject).finally(()=>{imageRunning--;pumpImages();});}}
function timeoutSignal(ms){return typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(ms):undefined;}
async function touchLru(cache,url,responseCopy){
 try{await cache.delete(url);await cache.put(url,responseCopy);}catch{}
}
async function storeImage(cache,url,response,limit){
 try{
  await cache.delete(url);
  await cache.put(url,response.clone());
 }catch{
  try{
   const keys=await cache.keys();
   for(const key of keys.slice(0,Math.max(1,Math.floor(keys.length*0.2))))await cache.delete(key);
   await cache.put(url,response.clone());
  }catch{}
 }
 try{
  const keys=await cache.keys();
  for(const key of keys.slice(0,Math.max(0,keys.length-limit)))await cache.delete(key);
 }catch{}
}
async function fetchImage(request){
 let response,host='',sameOrigin=false;
 try{
  const parsed=new URL(request.url);host=parsed.hostname;
  sameOrigin=!!self.registration?.scope&&parsed.origin===new URL(self.registration.scope).origin;
 }catch{}
 const signal=timeoutSignal(20000);
 if(sameOrigin){
  response=await fetch(new Request(request.url,{credentials:'omit',signal}));
 }else if(host&&noCorsHosts.has(host)){
  response=await fetch(new Request(request.url,{mode:'no-cors',credentials:'omit',referrerPolicy:'no-referrer',signal}));
 }else{
  try{
   response=await fetch(new Request(request.url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal}));
  }catch(error){
   if(signal?.aborted)throw error;
   response=await fetch(new Request(request.url,{mode:'no-cors',credentials:'omit',referrerPolicy:'no-referrer',signal}));
   if(response.type==='opaque'&&host)noCorsHosts.add(host);
  }
 }
 if(!response.ok&&response.type!=='opaque')return response;
 const opaque=response.type==='opaque',type=response.headers?.get?.('content-type')||'';
 if(!opaque&&type&&!/^image\//i.test(type))return response;
 const size=Number(response.headers?.get?.('content-length')||0);
 if(size>2500000)return response;
 try{
  const cache=await caches.open(opaque?OPAQUE_CACHE:IMAGE_CACHE);
  await storeImage(cache,request.url,response,opaque?OPAQUE_LIMIT:IMAGE_LIMIT);
 }catch{}
 return response;
}
async function imageResponse(request){
 for(const name of [IMAGE_CACHE,OPAQUE_CACHE]){
  try{
   const cache=await caches.open(name),cached=await cache.match(request.url,{ignoreVary:true});
   if(cached){
    const copy=cached.clone();
    touchLru(cache,request.url,copy);
    return cached;
   }
  }catch{}
 }
 const key=request.url;
 if(!imagePending.has(key)){
  const task=queuedImage(request);
  imagePending.set(key,task);
  task.finally(()=>imagePending.delete(key)).catch(()=>{});
 }
 return (await imagePending.get(key)).clone();
}
function shellResponse(event,url){
 if(url.searchParams?.has('v')){
  return caches.open(CACHE).then(async cache=>{
   const hit=await cache.match(event.request);
   if(hit)return hit;
   const response=await fetch(event.request);
   if(response.ok)event.waitUntil(cache.put(event.request,response.clone()));
   return response;
  }).catch(async()=>(await caches.match(event.request,{ignoreSearch:true}))||new Response('离线资源不可用，请联网重试。',{status:503}));
 }
 const network=fetch(event.request,{cache:'no-cache'}).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
  return response;
 });
 const cached=()=>caches.match(event.request,{ignoreSearch:true});
 if(typeof setTimeout!=='function'){
  return network.catch(async()=>(await cached())||new Response('离线资源不可用，请联网重试。',{status:503}));
 }
 return (async()=>{
  let timer;
  const slow=new Promise(resolve=>{timer=setTimeout(()=>resolve('slow'),1500);});
  try{
   const first=await Promise.race([network,slow]);
   clearTimeout(timer);
   if(first!=='slow')return first;
   const hit=await cached();
   if(hit){event.waitUntil(network.catch(()=>{}));return hit;}
   return await network;
  }catch{
   clearTimeout(timer);
   const hit=await cached();
   return hit||new Response('离线资源不可用，请联网重试。',{status:503});
  }
 })();
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),base=new URL(self.registration.scope);
 if(event.request.method!=='GET')return;
 const ownPreview=url.origin===base.origin&&url.pathname.startsWith(base.pathname+'photo-data/images/')&&/^images\/(tt|nm)\d{5,12}\/[a-f0-9]{24}\.webp$/.test(url.pathname.slice((base.pathname+'photo-data/').length));
 if(event.request.destination==='image'&&(url.protocol==='https:'&&IMAGE_HOST.test(url.hostname)||ownPreview)){event.respondWith(imageResponse(event.request));return;}
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
 const rel=url.pathname.slice(base.pathname.length);if(!FILES.includes('./'+rel))return;
 event.respondWith(shellResponse(event,url));
});
