import {readFile,writeFile} from 'node:fs/promises';
import {verifyPhotoSubject,registerPhotoSubject} from './photo-request.mjs';

const base=process.env.PHOTO_QUEUE_URL;let key=process.env.PHOTO_QUEUE_KEY;
if(!base){if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'has_requests=false\n',{flag:'a'});console.log('Photo queue is not enabled.');process.exit(0);}
if(!key){const endpoint=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;if(!endpoint||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('GitHub task identity is unavailable');const url=new URL(endpoint);url.searchParams.set('audience','isolate-photo-queue');const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});if(!response.ok)throw Error('Could not obtain task identity');key=(await response.json()).value;if(!key)throw Error('Task identity is empty');}
const call=async(path,body)=>{const response=await fetch(new URL(path,base),{method:body?'POST':'GET',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+key,...(process.env.PHOTO_QUEUE_SITE_ACCESS?{'OAI-Sites-Authorization':'Bearer '+process.env.PHOTO_QUEUE_SITE_ACCESS}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('Photo queue returned HTTP '+response.status);return response.json();};
const status=process.env.PHOTO_QUEUE_RESULT;
if(status){const ids=JSON.parse(await readFile(new URL('../.data/photo-queue-ids.json',import.meta.url),'utf8'));await call('internal/results',{items:ids.map(id=>({id,status}))});process.exit(0);}
const {items}=await call('internal/pending');if(!Array.isArray(items)||items.length>8||items.some(item=>!/^(tt|nm)\d{5,12}$/.test(item.id||'')))throw Error('Invalid public queue response');
const registry=new URL('../photo-data/subjects.json',import.meta.url);let subjects=JSON.parse(await readFile(registry,'utf8'));const accepted=[];
for(const {id} of items){try{subjects=registerPhotoSubject(subjects,{...await verifyPhotoSubject(id),cachePhotos:true});accepted.push(id);}catch{await call('internal/results',{items:[{id,status:'failed'}]});}}
if(accepted.length){const {mkdir}=await import('node:fs/promises');await mkdir(new URL('../.data/',import.meta.url),{recursive:true});await writeFile(new URL('../.data/photo-queue-ids.json',import.meta.url),JSON.stringify(accepted));await writeFile(registry,JSON.stringify(subjects,null,2)+'\n');await call('internal/results',{items:accepted.map(id=>({id,status:'processing'}))});}
if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'has_requests='+(accepted.length>0)+'\nsubject_ids='+accepted.join(',')+'\n',{flag:'a'});
console.log(JSON.stringify({stage:'public-queue',accepted}));
