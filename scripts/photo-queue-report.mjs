// Short-lived GitHub task identity stays in this collector process.
import {cleanAlbum,photoKey} from '../public/collection.js';
export function summarizePhotoCrawl(before,after){
 const old=new Set(cleanAlbum(Object.values(before||{}).flatMap(source=>source?.images||[])).map(image=>photoKey(image.url)));
 const images=cleanAlbum(Object.values(after||{}).flatMap(source=>source?.images||[]));
 return {total:images.length,added:images.filter(image=>!old.has(photoKey(image.url))).length};
}
let identity,identityPending;const pending=new Map();
async function collectorKey(){
 if(process.env.PHOTO_QUEUE_KEY)return process.env.PHOTO_QUEUE_KEY;
 if(identity?.expiresAt>Date.now()+60000)return identity.token;
 if(!identityPending)identityPending=(async()=>{
  const endpoint=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;if(!endpoint||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('GitHub task identity is unavailable');
  const url=new URL(endpoint);url.searchParams.set('audience','isolate-photo-queue');
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}});
  if(!response.ok)throw Error('Could not obtain task identity');const value=(await response.json()).value;if(!value)throw Error('Task identity is empty');
  const claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString('utf8'));identity={token:value,expiresAt:Number(claims.exp)*1000};return value;
 })();
 try{return await identityPending;}finally{identityPending=null;}
}
export async function queueCall(path,body){
 const key=await collectorKey(),response=await fetch(new URL(path,process.env.PHOTO_QUEUE_URL),{method:body?'POST':'GET',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+key,...(process.env.PHOTO_QUEUE_SITE_ACCESS?{'OAI-Sites-Authorization':'Bearer '+process.env.PHOTO_QUEUE_SITE_ACCESS}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error('Photo queue returned HTTP '+response.status);return response.json();
}
export async function reportPhotoProgress(id,patch,{required=false}={}){
 if(process.env.PHOTO_QUEUE_PROGRESS!=='1')return;
 const job=(pending.get(id)||Promise.resolve()).catch(()=>{}).then(()=>queueCall('internal/results',{items:[{id,status:'processing',...(process.env.GITHUB_RUN_ID?{runId:process.env.GITHUB_RUN_ID}:{}),...patch}]}));pending.set(id,job);
 try{return await job;}
 catch(error){if(required)throw error;console.log(JSON.stringify({stage:'progress-unavailable',id}));}
 finally{if(pending.get(id)===job)pending.delete(id);}
}
