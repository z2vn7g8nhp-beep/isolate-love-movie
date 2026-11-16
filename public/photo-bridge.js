const CHANNEL='isolate-photo-bridge-v1',documents=new WeakMap();let sequence=0;
const failure=message=>Object.assign(Error(message||'备用补图连接暂时不可用'),{code:'bridge',retryable:true});
export function photoBridgeSupported(){return !!globalThis.window?.addEventListener&&!!globalThis.document?.createElement;}
export function standalonePhotoApp(navigator=globalThis.navigator,window=globalThis.window){return !!navigator?.standalone||!!window?.matchMedia?.('(display-mode: standalone)').matches;}
function connection(baseUrl,{window=globalThis.window,document=globalThis.document,timeout=12000}={}){
 if(!window?.addEventListener||!document?.createElement)throw failure();
 const origin=new URL(baseUrl).origin;let entries=documents.get(document);if(!entries){entries=new Map();documents.set(document,entries);}if(entries.has(origin))return entries.get(origin);
 const frame=document.createElement('iframe'),entry={frame,origin,pending:new Map(),ready:false};
 frame.title='ISOLATE 图片连接';frame.setAttribute('aria-hidden','true');frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.tabIndex=-1;
 frame.style.cssText='position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;border:0';
 entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
 const cleanup=()=>{window.removeEventListener('message',entry.listener);frame.remove();entries.delete(origin);};
 entry.reset=()=>{cleanup();for(const task of entry.pending.values()){clearTimeout(task.timer);task.reject(failure('备用补图连接需要重新建立'));}entry.pending.clear();};
 entry.listener=event=>{
  const data=event.data;if(event.origin!==origin||event.source!==frame.contentWindow||data?.channel!==CHANNEL)return;
  if(data.kind==='ready'){if(!entry.ready){entry.ready=true;clearTimeout(entry.timer);entry.resolve(entry);}return;}
  if(data.kind!=='result'||!entry.pending.has(data.requestId))return;const task=entry.pending.get(data.requestId);entry.pending.delete(data.requestId);clearTimeout(task.timer);
  if(data.error)task.reject(Object.assign(Error(String(data.error).slice(0,200)),{code:'bridge',retryable:data.retryable!==false,status:data.status}));else task.resolve({result:data.result,session:data.session});
 };
 entries.set(origin,entry);window.addEventListener('message',entry.listener);entry.timer=setTimeout(()=>{cleanup();entry.reject(failure('备用补图连接暂时无法建立'));},timeout);
 frame.addEventListener('load',()=>frame.contentWindow?.postMessage({channel:CHANNEL,kind:'ping'},origin));frame.src=new URL('bridge',baseUrl).href;(document.body||document.documentElement).appendChild(frame);return entry;
}
export async function requestPhotoBridge(id,{readOnly=false,baseUrl,session,window,document,timeout=15000}={}){
 if(!/^(tt|nm)\d{5,12}$/.test(id||''))throw Object.assign(Error('请先关联公开影视或人物编号'),{code:'invalid-id',retryable:false});
 const entry=connection(baseUrl,{window,document,timeout}),ready=await entry.promise;const requestId='q'+Date.now().toString(36)+'-'+(++sequence).toString(36);
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{entry.pending.delete(requestId);reject(failure('备用补图连接响应超时'));entry.reset();},timeout);entry.pending.set(requestId,{resolve,reject,timer});
  ready.frame.contentWindow.postMessage({channel:CHANNEL,kind:readOnly?'status':'request',requestId,id,...(session&&/^[a-f0-9]{64}$/.test(session.token||'')?{session:{token:session.token,expiresAt:session.expiresAt}}:{})},entry.origin);
 });
}
