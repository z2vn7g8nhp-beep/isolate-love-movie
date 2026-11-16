// Only public IDs and an anonymous, device-local queue session cross this boundary.
export const PHOTO_QUEUE_BASE='https://isolate-photo-queue-z2vn.modestdrum3.chatgpt.site/';
const SESSION='isolate.photo-queue-session.v1';let pendingSession;
async function responseJson(response){let data;try{data=await response.json();}catch{throw Error('补图服务尚未接通，请稍后再试');}if(!response.ok)throw Object.assign(Error(data.error||'补图服务暂不可用'),{status:response.status});return data;}
async function deviceSession({storage=globalThis.localStorage,fetcher=fetch,baseUrl=PHOTO_QUEUE_BASE}={}){
 let old;try{old=JSON.parse(storage?.getItem(SESSION)||'null');}catch{}if(old?.token&&old.expiresAt>Date.now()+60000)return old.token;
 if(pendingSession)return pendingSession;
 const task=(async()=>{const data=await responseJson(await fetcher(new URL('api/session',baseUrl).href,{method:'POST',credentials:'omit',signal:AbortSignal.timeout(15000)}));if(!/^[a-f0-9]{64}$/.test(data.token))throw Error('补图连接未正确建立');try{storage?.setItem(SESSION,JSON.stringify(data));}catch{}return data.token;})();pendingSession=task;try{return await task;}finally{pendingSession=null;}
}
export async function requestPhotoTask(id,{readOnly=false,storage=globalThis.localStorage,fetcher=fetch,baseUrl=PHOTO_QUEUE_BASE}={}){
 if(!/^(tt|nm)\d{5,12}$/.test(id||''))throw Error('请先关联公开影视或人物编号');
 for(let attempt=0;attempt<2;attempt++){
  const token=await deviceSession({storage,fetcher,baseUrl}),url=new URL(readOnly?'api/requests/'+id:'api/requests',baseUrl);
  const response=await fetcher(url.href,{method:readOnly?'GET':'POST',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,...(!readOnly?{'Content-Type':'application/json'}:{})},...(!readOnly?{body:JSON.stringify({id})}:{})});
  if(response.status===401&&attempt===0){try{storage?.removeItem(SESSION);}catch{}continue;}return responseJson(response);
 }
 throw Error('补图连接已失效，请重新读取');
}
