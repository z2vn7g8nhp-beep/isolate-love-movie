import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const workerSource=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function memoryCaches(){const stores=new Map();return {async open(name){if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {async match(input){return map.get(typeof input==='string'?input:input.url)?.clone();},async put(input,response){map.set(typeof input==='string'?input:input.url,response.clone());},async keys(){return [...map.keys()].map(url=>new Request(url));},async delete(input){return map.delete(typeof input==='string'?input:input.url);}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};}
function worker(caches,fetch){const handlers={};const context=vm.createContext({URL,Request,Response,AbortSignal,Map,Promise,caches,fetch,self:{registration:{scope:'https://example.com/app/'},clients:{claim:async()=>{}},addEventListener(name,handler){handlers[name]=handler;},skipWaiting:async()=>{}}});vm.runInContext(workerSource,context);return {context,handlers};}

test('persistent image cache survives worker restarts and prevents repeat network downloads',async()=>{
 const caches=memoryCaches();let requests=0;const fetch=async()=>{requests++;return new Response('image bytes',{headers:{'content-type':'image/jpeg','content-length':'11'}});};
 const first=worker(caches,fetch);await vm.runInContext("imageResponse(new Request('https://static.tvmaze.com/one.jpg'))",first.context);assert.equal(requests,1);
 const restarted=worker(caches,fetch);const response=await vm.runInContext("imageResponse(new Request('https://static.tvmaze.com/one.jpg'))",restarted.context);assert.equal(await response.text(),'image bytes');assert.equal(requests,1);
});

test('image requests have bounded concurrency and old UI cache cleanup keeps photos',async()=>{
 const caches=memoryCaches();await caches.open('isolate-pages-old');await caches.open('isolate-images-v1');let active=0,peak=0;
 const {context,handlers}=worker(caches,async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response('photo');});
 await Promise.all(Array.from({length:9},(_,i)=>vm.runInContext("imageResponse(new Request('https://static.tvmaze.com/"+i+".jpg'))",context)));assert.ok(peak<=4);let activation;handlers.activate({waitUntil(task){activation=task;}});await activation;assert.equal((await caches.keys()).includes('isolate-images-v1'),true);assert.equal((await caches.keys()).includes('isolate-pages-old'),false);
});

test('image caching only intercepts known image providers',()=>{
 const {handlers}=worker(memoryCaches(),()=>{throw Error('unexpected network');});let intercepted=false;handlers.fetch({request:{url:'https://example.org/private.jpg',method:'GET',destination:'image'},respondWith(){intercepted=true;}});assert.equal(intercepted,false);
});
