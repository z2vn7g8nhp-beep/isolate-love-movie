import {readFile,writeFile} from 'node:fs/promises';
import {verifyPhotoSubject,registerPhotoSubject} from './photo-request.mjs';
import {queueCall as call} from './photo-queue-report.mjs';

const base=process.env.PHOTO_QUEUE_URL;
if(!base){if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'has_requests=false\n',{flag:'a'});console.log('Photo queue is not enabled.');process.exit(0);}
const status=process.env.PHOTO_QUEUE_RESULT;
const run=process.env.GITHUB_RUN_ID?{runId:process.env.GITHUB_RUN_ID}:{};
if(status){
 const ids=JSON.parse(await readFile(new URL('../.data/photo-queue-ids.json',import.meta.url),'utf8'));let results={};try{results=JSON.parse(await readFile(new URL('../.data/photo-queue-results.json',import.meta.url),'utf8'));}catch{}
 await call('internal/results',{items:ids.map(id=>({id,status,...run,...(status==='done'?results[id]:{})}))});process.exit(0);
}
const {items}=await call('internal/pending');if(!Array.isArray(items)||items.length>8||items.some(item=>!/^(tt|nm)\d{5,12}$/.test(item.id||'')))throw Error('Invalid public queue response');
if(items.length)await call('internal/results',{items:items.map(({id})=>({id,status:'processing',stage:'preparing',...run}))});
const registry=new URL('../photo-data/subjects.json',import.meta.url);let subjects=JSON.parse(await readFile(registry,'utf8'));const accepted=[];
for(const {id} of items){try{subjects=registerPhotoSubject(subjects,{...await verifyPhotoSubject(id),cachePhotos:true});accepted.push(id);}catch{await call('internal/results',{items:[{id,status:'failed',...run}]});}}
if(accepted.length){const {mkdir}=await import('node:fs/promises');await mkdir(new URL('../.data/',import.meta.url),{recursive:true});await writeFile(new URL('../.data/photo-queue-ids.json',import.meta.url),JSON.stringify(accepted));await writeFile(registry,JSON.stringify(subjects,null,2)+'\n');}
if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'has_requests='+(accepted.length>0)+'\nsubject_ids='+accepted.join(',')+'\n',{flag:'a'});
console.log(JSON.stringify({stage:'public-queue',accepted}));
