import test from 'node:test';
import assert from 'node:assert/strict';
import queue,{verifyCollectorToken} from '../server/photo-queue.mjs';
import {requestPhotoTask} from '../public/photo-queue-client.js';

class Bucket{data=new Map();async get(key){const value=this.data.get(key);return value?{json:async()=>JSON.parse(value)}:null;}async put(key,value){this.data.set(key,value);}async delete(key){this.data.delete(key);}async list({prefix,limit}){return {objects:[...this.data.keys()].filter(key=>key.startsWith(prefix)).slice(0,limit).map(key=>({key}))};}}
const origin='https://z2vn7g8nhp-beep.github.io';
const call=(env,path,{method='GET',body,token,from=origin}={})=>queue.fetch(new Request('https://queue.example/'+path,{method,headers:{Origin:from,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
test('anonymous device sessions authorize only bounded public-ID requests, with no private record accepted',async()=>{
 const env={BUCKET:new Bucket(),CRAWL_KEY:'server-key'};
 assert.equal((await call(env,'api/session',{method:'POST',from:'https://unrelated.example'})).status,403);
 assert.equal((await call(env,'api/requests',{method:'POST',body:{id:'nm3641002'}})).status,401);
 const {token}=await(await call(env,'api/session',{method:'POST'})).json();assert.match(token,/^[a-f0-9]{64}$/);
 assert.equal((await call(env,'api/requests',{method:'POST',token,body:{id:'nm3641002',note:'PRIVATE'}})).status,400);
 assert.equal((await call(env,'api/requests',{method:'POST',token,body:{id:'../../private'}})).status,400);
 const accepted=await call(env,'api/requests',{method:'POST',token,body:{id:'nm3641002'}});assert.equal(accepted.status,202);
 const again=await(await call(env,'api/requests',{method:'POST',token,body:{id:'nm3641002'}})).json();assert.equal(again.status,'queued');
 assert.equal([...env.BUCKET.data.keys()].filter(key=>key.startsWith('requests/')).length,1);assert.doesNotMatch(JSON.stringify([...env.BUCKET.data]),/PRIVATE/);
 for(let n=0;n<29;n++)assert.equal((await call(env,'api/requests',{method:'POST',token,body:{id:'tt10000'+n}})).status,202);
 assert.equal((await call(env,'api/requests',{method:'POST',token,body:{id:'tt9999999'}})).status,429);
});
test('queue remains pending until an authenticated collector publishes a result',async()=>{
 const env={BUCKET:new Bucket(),CRAWL_KEY:'server-key'},token=(await(await call(env,'api/session',{method:'POST'})).json()).token;
 await call(env,'api/requests',{method:'POST',token,body:{id:'nm3641002'}});
 assert.equal((await call(env,'internal/pending')).status,401);
 const pending=await(await call(env,'internal/pending',{token:'server-key'})).json();assert.deepEqual(pending,{items:[{id:'nm3641002'}]});
 for(const status of ['processing','done'])assert.equal((await call(env,'internal/results',{method:'POST',token:'server-key',body:{items:[{id:'nm3641002',status}]}})).status,200);
 assert.equal((await(await call(env,'api/requests/nm3641002',{token})).json()).status,'done');
 assert.deepEqual(await(await call(env,'internal/pending',{token:'server-key'})).json(),{items:[]});
 assert.equal((await call(env,'internal/results',{method:'POST',token,body:{items:[{id:'nm3641002',status:'done'}]}})).status,401);
});
test('in-app client silently creates one local queue session and sends only one public ID',async()=>{
 const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},env={BUCKET:new Bucket(),CRAWL_KEY:'key'},requests=[];
 const fetcher=async(url,options)=>{requests.push({url,options});return queue.fetch(new Request(url,{...options,headers:{...options.headers,Origin:origin}}),env);};
 const options={storage,fetcher,baseUrl:'https://queue.example/'};
 assert.equal((await requestPhotoTask('nm3641002',options)).status,'queued');
 assert.equal((await requestPhotoTask('nm3641002',{...options,readOnly:true})).status,'queued');
 assert.equal(requests.filter(row=>row.url.endsWith('/api/session')).length,1);
 assert.equal(requests.find(row=>row.url.endsWith('/api/requests')).options.body,'{"id":"nm3641002"}');
 assert.equal(requests.some(row=>row.url.includes('github.com')),false);assert.equal(requests.every(row=>row.options.credentials==='omit'),true);
});

test('collector identity requires a valid GitHub signature, this repository, workflow, audience and main branch',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'queue-test-key'};let keyReads=0;
 const fetcher=async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');keyReads++;return new Response(JSON.stringify({keys:[jwk]}));};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'isolate-photo-queue',repository:'z2vn7g8nhp-beep/isolate-love-movie',ref:'refs/heads/main',workflow_ref:'z2vn7g8nhp-beep/isolate-love-movie/.github/workflows/photo-queue.yml@refs/heads/main',exp:Date.now()/1000+600,nbf:Date.now()/1000-5};
 const sign=async value=>{const head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),body=Buffer.from(JSON.stringify(value)).toString('base64url'),input=head+'.'+body;return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(input))).toString('base64url');};
 const good=await sign(claims);assert.equal(await verifyCollectorToken(good,{fetcher}),true);assert.equal(keyReads,1);
 for(const patch of [{repository:'someone/other'},{ref:'refs/heads/other'},{aud:'other-app'},{exp:0},{workflow_ref:'z2vn7g8nhp-beep/isolate-love-movie/.github/workflows/pages.yml@refs/heads/main'}])assert.equal(await verifyCollectorToken(await sign({...claims,...patch}),{fetcher}),false);
 const [head,body,signature]=good.split('.');assert.equal(await verifyCollectorToken(head+'.'+body+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1),{fetcher}),false);
});
