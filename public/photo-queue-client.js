// A simple CORS POST avoids preflight requests in mobile/home-screen browsers.
// The session authorizes only this public-ID queue; it is never a GitHub credential.
export const PHOTO_QUEUE_BASE='https://isolate-photo-queue-z2vn.modestdrum3.chatgpt.site/';
const SESSION='isolate.photo-queue-session.v1',memorySessions=new Map(),pendingSessions=new Map();
export class PhotoQueueError extends Error{constructor(message,{code='service',status,retryable=false}={}){super(message);this.name='PhotoQueueError';this.code=code;this.status=status;this.retryable=retryable;}}
async function send(fetcher,url,options){try{return await fetcher(url,options);}catch(error){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw new PhotoQueueError('补图服务连接超时',{code:'timeout',retryable:true});throw new PhotoQueueError('暂时无法连接补图服务',{code:'network',retryable:true});}}
async function responseJson(response){let data;try{data=await response.json();}catch{throw new PhotoQueueError('补图服务暂时没有返回有效响应',{code:'bad-response',status:response.status,retryable:true});}if(!response.ok)throw new PhotoQueueError(data.error||'补图服务暂不可用',{code:'http',status:response.status,retryable:response.status>=500||response.status===408});return data;}
async function deviceSession({storage=globalThis.localStorage,fetcher=fetch,baseUrl=PHOTO_QUEUE_BASE}={}){
 let old=memorySessions.get(baseUrl);try{old||=JSON.parse(storage?.getItem(SESSION)||'null');}catch{}if(old?.token&&old.expiresAt>Date.now()+60000)return old.token;
 if(pendingSessions.has(baseUrl))return pendingSessions.get(baseUrl);
 const task=(async()=>{const data=await responseJson(await send(fetcher,new URL('api/session',baseUrl).href,{method:'POST',credentials:'omit',signal:AbortSignal.timeout(15000)}));if(!/^[a-f0-9]{64}$/.test(data.token))throw new PhotoQueueError('补图连接未正确建立',{retryable:true});memorySessions.set(baseUrl,data);try{storage?.setItem(SESSION,JSON.stringify(data));}catch{}return data.token;})();pendingSessions.set(baseUrl,task);try{return await task;}finally{pendingSessions.delete(baseUrl);}
}
export async function requestPhotoTask(id,{readOnly=false,storage=globalThis.localStorage,fetcher=fetch,baseUrl=PHOTO_QUEUE_BASE}={}){
 if(!/^(tt|nm)\d{5,12}$/.test(id||''))throw new PhotoQueueError('请先关联公开影视或人物编号',{code:'invalid-id'});
 for(let attempt=0;attempt<2;attempt++){
  const token=await deviceSession({storage,fetcher,baseUrl}),url=new URL(readOnly?'api/status':'api/requests',baseUrl);
  const response=await send(fetcher,url.href,{method:'POST',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({id,session:token})});
  if(response.status===401&&attempt===0){memorySessions.delete(baseUrl);try{storage?.removeItem(SESSION);}catch{}continue;}
  const result=await responseJson(response);if(result.id!==id||!['queued','processing','done','failed','missing'].includes(result.status))throw new PhotoQueueError('补图状态暂时无法核对',{code:'bad-response',retryable:true});return result;
 }
 throw new PhotoQueueError('补图连接已失效，请重新读取',{code:'session',retryable:true});
}
