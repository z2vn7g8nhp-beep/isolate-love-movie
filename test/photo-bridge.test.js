import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import queue,{photoBridgeRuntime,photoBridgeResponse} from '../server/photo-queue.mjs';
import {requestPhotoBridge,standalonePhotoApp} from '../public/photo-bridge.js';
import {requestPhotoTask} from '../public/photo-queue-client.js';
const origin='https://z2vn7g8nhp-beep.github.io',service='https://bridge.example',channel='isolate-photo-bridge-v1';
class Bucket{data=new Map();async get(key){const value=this.data.get(key);return value?{json:async()=>JSON.parse(value)}:null;}async put(key,value){this.data.set(key,value);}async delete(key){this.data.delete(key);}async list({prefix,limit}){return {objects:[...this.data.keys()].filter(key=>key.startsWith(prefix)).slice(0,limit).map(key=>({key}))};}}
function harness({block,ready=true,ignoreRequests=false}={}){
 const listeners=new Set(),childListeners=new Set(),frames=[],requests=[],sent=[],env={BUCKET:new Bucket()};let frame;
 const parentWindow={addEventListener:(name,fn)=>{if(name==='message')listeners.add(fn);},removeEventListener:(name,fn)=>listeners.delete(fn)};
 const dispatchParent=(data,from=service,source=frame.contentWindow)=>{for(const fn of listeners)fn({origin:from,source,data:structuredClone(data)});};
 const parentProxy={postMessage(data,target){assert.equal(target,origin);queueMicrotask(()=>dispatchParent(data));}};
 const childWindow={parent:parentProxy,location:{origin:service},addEventListener:(name,fn)=>{if(name==='message')childListeners.add(fn);}};
 const dispatchChild=(data,from=origin,source=parentProxy)=>{for(const fn of childListeners)fn({origin:from,source,data:structuredClone(data)});};
 const fetcher=async(url,options)=>{assert.equal(new URL(url).origin,service);requests.push({url,options});if(block)await block;return queue.fetch(new Request(url,{...options,headers:{...options.headers,Origin:service}}),env);};
 const document={createElement(tag){assert.equal(tag,'iframe');const loads=[];frame={style:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(name,fn){if(name==='load')loads.push(fn);},remove(){this.removed=true;},contentWindow:{postMessage(data,target){assert.equal(target,service);sent.push(data);if(!ignoreRequests||data.kind==='ping')queueMicrotask(()=>dispatchChild(data));}},loads};frames.push(frame);return frame;},body:{appendChild(){childListeners.clear();if(ready)vm.runInNewContext('('+photoBridgeRuntime.toString()+')();',{window:childWindow,fetch:fetcher,URL,AbortController,setTimeout,clearTimeout,Date,Promise});for(const fn of frame.loads)fn();}}};
 return {window:parentWindow,document,frames,requests,sent,env,dispatchChild,dispatchParent,setIgnoreRequests(value){ignoreRequests=value;}};
}

test('bridge completes authenticated requests on its own origin and reuses one hidden frame/session',async()=>{
 const h=harness(),options={baseUrl:service+'/',window:h.window,document:h.document,timeout:1000};
 const first=await requestPhotoBridge('nm10514458',options);assert.equal(first.result.status,'queued');assert.match(first.session.token,/^[a-f0-9]{64}$/);
 const [status,second]=await Promise.all([requestPhotoBridge('nm10514458',{...options,readOnly:true}),requestPhotoBridge('tt0816692',options)]);assert.equal(status.result.status,'queued');assert.equal(second.result.status,'queued');assert.equal(h.frames.length,1);
 assert.equal(h.requests.filter(row=>row.url.endsWith('/api/session')).length,1);assert.equal(h.frames[0].attributes.sandbox,'allow-scripts allow-same-origin');assert.equal(h.frames[0].attributes['aria-hidden'],'true');
 assert.ok(h.requests.every(row=>row.options.credentials==='omit'&&row.options.mode==='same-origin'&&row.options.referrerPolicy==='same-origin'));assert.ok(h.sent.filter(row=>row.kind!=='ping').every(row=>Object.keys(row).every(key=>['channel','kind','requestId','id','session'].includes(key))));
});

test('message origin, source window and fixed operation are enforced on both sides',async()=>{
 let release;const block=new Promise(resolve=>release=resolve),h=harness({block}),options={baseUrl:service+'/',window:h.window,document:h.document,timeout:1000};let settled=false;
 const job=requestPhotoBridge('nm10514458',options).then(value=>{settled=true;return value;});await new Promise(resolve=>setImmediate(resolve));const rpc=h.sent.find(row=>row.kind==='request');assert.ok(rpc);
 const fake={channel,kind:'result',requestId:rpc.requestId,result:{id:'nm10514458',status:'done'}};
 h.dispatchParent(fake,'https://unrelated.example');h.dispatchParent(fake,service,{});await Promise.resolve();assert.equal(settled,false);
 const before=h.requests.length;h.dispatchChild({...rpc,requestId:'other',url:'https://private.example/' });h.dispatchChild({...rpc,requestId:'other'},'https://unrelated.example');h.dispatchChild({...rpc,requestId:'other'},origin,{});assert.equal(h.requests.length,before);
 release();assert.equal((await job).result.status,'queued');
});

test('a blocked frame times out cleanly and can be recreated',async()=>{
 const h=harness({ready:false});await assert.rejects(requestPhotoBridge('nm10514458',{baseUrl:service+'/',window:h.window,document:h.document,timeout:20}),error=>error.retryable);assert.equal(h.frames[0].removed,true);
 await assert.rejects(requestPhotoBridge('nm10514458',{baseUrl:service+'/',window:h.window,document:h.document,timeout:20}),error=>error.retryable);assert.equal(h.frames.length,2);
});

test('bridge document has a nonce policy, accepts only the archive ancestor and no third-party connections',async()=>{
 const response=photoBridgeResponse(),policy=response.headers.get('content-security-policy'),html=await response.text();assert.match(policy,/connect-src 'self'/);assert.ok(policy.includes('frame-ancestors '+origin));assert.match(policy,/base-uri 'none'/);const nonce=html.match(/<script nonce="([a-f0-9]+)">/)[1];assert.ok(policy.includes("'nonce-"+nonce+"'"));assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'same-origin');assert.doesNotMatch(html,/github_pat_|ghp_/);
 const own=await queue.fetch(new Request(service+'/api/session',{method:'POST',headers:{Origin:service}}),{BUCKET:new Bucket()});assert.equal(own.status,200);
 const other=await queue.fetch(new Request(service+'/api/session',{method:'POST',headers:{Origin:'https://unrelated.example'}}),{BUCKET:new Bucket()});assert.equal(other.status,403);
});

test('a failed direct fetch switches to the bridge and remembers its anonymous session',async()=>{
 const state=new Map(),storage={getItem:key=>state.get(key),setItem:(key,value)=>state.set(key,value),removeItem:key=>state.delete(key)};let direct=0,bridged=0;const id='nm10514458';
 const options={baseUrl:'https://fallback.example/',storage,fetcher:async()=>{direct++;throw TypeError('Load failed');},bridgeRequester:async(requested,opts)=>{assert.equal(requested,id);bridged++;return {result:{id,status:'queued'},session:{token:'a'.repeat(64),expiresAt:Date.now()+86400000}};}};
 assert.equal((await requestPhotoTask(id,options)).status,'queued');assert.equal((await requestPhotoTask(id,{...options,readOnly:true})).status,'queued');assert.equal(direct,1);assert.equal(bridged,2);assert.equal(JSON.parse([...state.values()][0]).transport,'bridge');
 assert.equal(standalonePhotoApp({standalone:true},{}),true);assert.equal(standalonePhotoApp({}, {matchMedia:()=>({matches:true})}),true);assert.equal(standalonePhotoApp({},{}),false);
});

test('home-screen mode can prefer the bridge without first making the failing cross-origin request',async()=>{
 let direct=0;const id='nm10514458';const row=await requestPhotoTask(id,{baseUrl:'https://standalone.example/',preferBridge:true,storage:{getItem:()=>null,setItem(){}},fetcher:async()=>{direct++;throw Error('Must not fetch');},bridgeRequester:async()=>({result:{id,status:'queued'},session:{token:'b'.repeat(64),expiresAt:Date.now()+86400000}})});assert.equal(row.status,'queued');assert.equal(direct,0);
});

test('a suspended ready frame is replaced after timeout instead of remaining permanently stuck',async()=>{
 const h=harness({ignoreRequests:true}),options={baseUrl:service+'/',window:h.window,document:h.document,timeout:30};
 await assert.rejects(requestPhotoBridge('nm10514458',options),error=>error.retryable);assert.equal(h.frames[0].removed,true);h.setIgnoreRequests(false);assert.equal((await requestPhotoBridge('nm10514458',options)).result.status,'queued');assert.equal(h.frames.length,2);
});
