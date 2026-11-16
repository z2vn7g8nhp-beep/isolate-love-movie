// A bounded queue for public IMDb identifiers. No GitHub token or private record is accepted.
const WEB_ORIGIN='https://z2vn7g8nhp-beep.github.io';
const validId=id=>/^(tt|nm)\d{5,12}$/.test(id||'');
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const read=async(bucket,key)=>{const object=await bucket.get(key);return object?object.json():null;};
const write=(bucket,key,data)=>bucket.put(key,JSON.stringify(data),{httpMetadata:{contentType:'application/json'}});
async function limited(bucket,key,max){const now=Date.now(),old=await read(bucket,key),row=old&&old.until>now?old:{count:0,until:now+86400000};if(row.count>=max)return false;await write(bucket,key,{...row,count:row.count+1});return true;}
async function json(request,max=600){if(Number(request.headers.get('content-length'))>max)throw Error('请求过大');const body=await request.text();if(body.length>max)throw Error('请求过大');return JSON.parse(body);}
async function session(request,bucket,supplied){const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]||supplied;if(!/^[a-f0-9]{64}$/.test(token||''))return null;const row=await read(bucket,'sessions/'+await hash(token));return row&&row.until>Date.now()?row:null;}
const sources=['imdb','douban','pinterest'],sourceStates=['fetching','ok','empty','blocked','unmatched','unavailable'];
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
async function publicState(row,bucket){
 const state={id:row.id,status:row.status,stage:row.stage||(row.status==='processing'?'collecting':row.status),requestedAt:row.requestedAt,startedAt:row.startedAt||null,updatedAt:row.updatedAt||row.startedAt||row.requestedAt,finishedAt:row.finishedAt||null,message:row.message||'',sources:row.sources||{},...(row.summary?{summary:row.summary}:{}),...(row.dataCheckedAt?{dataCheckedAt:row.dataCheckedAt}:{})};
 if(row.status==='queued'){
  const objects=await bucket.list({prefix:'pending/',limit:200}),rows=await Promise.all(objects.objects.map(object=>read(bucket,object.key)));
  state.queueAhead=rows.filter(other=>other&&other.id!==row.id&&['queued','processing'].includes(other.status)&&Date.parse(other.requestedAt)<=Date.parse(row.requestedAt)).length;
  const collector=await read(bucket,'collector/state');state.lastCollectorAt=collector?.checkedAt||null;
 }
 return state;
}
function validProgress(item){
 return item&&validId(item.id)&&['processing','done','failed'].includes(item.status)&&Object.keys(item).every(key=>['id','status','stage','source','sourceStatus','total','newImages','summary','dataCheckedAt','runId'].includes(key))&&
  (!item.stage||['preparing','collecting','publishing'].includes(item.stage))&&(!item.source||sources.includes(item.source))&&(!item.sourceStatus||item.source&&sourceStates.includes(item.sourceStatus))&&
  (item.total===undefined||count(item.total))&&(item.newImages===undefined||count(item.newImages))&&(!item.summary||Object.keys(item.summary).every(key=>['total','added'].includes(key))&&count(item.summary.total)&&count(item.summary.added)&&item.summary.added<=item.summary.total)&&
  (!item.dataCheckedAt||timestamp(item.dataCheckedAt))&&(!item.runId||/^\d{1,20}$/.test(item.runId));
}
// This page accepts only the archive's parent-window messages and calls its own origin.
// It has no access to private archive records or to GitHub credentials.
export function photoBridgeRuntime(){
 const channel='isolate-photo-bridge-v1',parentOrigin='https://z2vn7g8nhp-beep.github.io';let currentSession,pendingSession,chain=Promise.resolve(),inflight=0;
 const validId=id=>/^(tt|nm)\d{5,12}$/.test(id||'');
 const reply=value=>window.parent.postMessage({channel,...value},parentOrigin);
 async function read(path,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(new URL(path,window.location.origin).href,{method:'POST',mode:'same-origin',referrerPolicy:'same-origin',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});let value;
   try{value=await response.json();}catch{throw Object.assign(Error('补图连接暂时没有返回有效响应'),{retryable:true});}
   if(!response.ok)throw Object.assign(Error(value.error||'补图连接暂时不可用'),{status:response.status,retryable:response.status>=500||response.status===408});return value;
  }finally{clearTimeout(timer);}
 }
 async function session(){
  if(currentSession?.token&&currentSession.expiresAt>Date.now()+60000)return currentSession;
  if(!pendingSession)pendingSession=(async()=>{const value=await read('/api/session');if(!/^[a-f0-9]{64}$/.test(value.token||''))throw Object.assign(Error('补图连接暂时未建立'),{retryable:true});currentSession={token:value.token,expiresAt:value.expiresAt};return currentSession;})();
  try{return await pendingSession;}finally{pendingSession=null;}
 }
 window.addEventListener('message',event=>{
  const data=event.data;if(event.origin!==parentOrigin||event.source!==window.parent||data?.channel!==channel)return;
  if(data.kind==='ping'){reply({kind:'ready'});return;}
  if(!['request','status'].includes(data.kind)||!validId(data.id)||!/^[a-z0-9-]{1,80}$/.test(data.requestId||'')||Object.keys(data).some(key=>!['channel','kind','requestId','id','session'].includes(key)))return;
  if(inflight>=16){reply({kind:'result',requestId:data.requestId,error:'补图连接正忙，请稍后重试',retryable:true});return;}
  inflight++;chain=chain.then(async()=>{
   try{
    if(!currentSession&&/^[a-f0-9]{64}$/.test(data.session?.token||'')&&Number(data.session.expiresAt)>Date.now())currentSession={token:data.session.token,expiresAt:data.session.expiresAt};
    for(let attempt=0;attempt<2;attempt++){
     const token=(await session()).token;try{const result=await read(data.kind==='status'?'/api/status':'/api/requests',{id:data.id,session:token});
      if(result.id!==data.id||!['queued','processing','done','failed','missing'].includes(result.status))throw Object.assign(Error('补图状态暂时无法核对'),{retryable:true});reply({kind:'result',requestId:data.requestId,result,session:currentSession});return;
     }catch(error){if(error.status===401&&attempt===0){currentSession=null;continue;}throw error;}
    }
   }catch(error){reply({kind:'result',requestId:data.requestId,error:error.status?String(error.message).slice(0,200):'备用补图连接暂时不可用',status:error.status,retryable:error.retryable!==false});}
   finally{inflight--;}
  }).catch(()=>{});
 });
 if(window.parent!==window)reply({kind:'ready'});
}
export function photoBridgeResponse(){
 const nonce=[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ISOLATE 图片连接</title><script nonce="'+nonce+'">('+photoBridgeRuntime.toString()+')();</script><body>ISOLATE 图片连接</body></html>';
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-ancestors "+WEB_ORIGIN+"; base-uri 'none'; form-action 'none'"}});
}
let publicKeys;
const unbase64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function verifyCollectorToken(token,{fetcher=fetch}={}){
 try{if(typeof token!=='string'||token.length>14000)return false;const parts=token.split('.');if(parts.length!==3)return false;
  const header=JSON.parse(new TextDecoder().decode(unbase64(parts[0]))),claims=JSON.parse(new TextDecoder().decode(unbase64(parts[1]))),now=Date.now()/1000;
  if(header.alg!=='RS256'||!header.kid||claims.iss!=='https://token.actions.githubusercontent.com'||claims.aud!=='isolate-photo-queue'||claims.repository!=='z2vn7g8nhp-beep/isolate-love-movie'||claims.ref!=='refs/heads/main'||claims.workflow_ref!=='z2vn7g8nhp-beep/isolate-love-movie/.github/workflows/photo-queue.yml@refs/heads/main'||!(claims.exp>now)||claims.nbf>now+60)return false;
  if(!publicKeys||publicKeys.until<Date.now()){const response=await fetcher('https://token.actions.githubusercontent.com/.well-known/jwks',{signal:AbortSignal.timeout(12000)});if(!response.ok)return false;publicKeys={...(await response.json()),until:Date.now()+300000};}
  const jwk=publicKeys.keys?.find(key=>key.kid===header.kid&&key.kty==='RSA');if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unbase64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
export default {async fetch(request,env){
 const url=new URL(request.url),origin=request.headers.get('origin'),allowed=origin===WEB_ORIGIN||origin===url.origin||env.ALLOW_LOCAL==='1'&&/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin||'');
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin',...(allowed?{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type'}:{})};
 const send=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers});
 if(request.method==='GET'&&url.pathname==='/health')return send({service:'isolate-photo-queue',version:3,bridge:true,progress:true});
 if(request.method==='GET'&&url.pathname==='/bridge')return photoBridgeResponse();
 const bucket=env.BUCKET;if(!bucket)return send({error:'队列存储尚未启用'},503);
 try{
  if(url.pathname.startsWith('/internal/')){
   const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!(env.CRAWL_KEY&&bearer===env.CRAWL_KEY)&&!await verifyCollectorToken(bearer))return send({error:'需要采集权限'},401);
   if(url.pathname==='/internal/pending'&&request.method==='GET'){
    await write(bucket,'collector/state',{checkedAt:new Date().toISOString()});
    const objects=await bucket.list({prefix:'pending/',limit:200}),rows=await Promise.all(objects.objects.map(object=>read(bucket,object.key)));
    const items=rows.filter(row=>row&&(row.status==='queued'||row.status==='processing'&&Date.now()-Date.parse(row.updatedAt||row.startedAt)>900000)&&row.attempts<3).sort((a,b)=>Date.parse(a.requestedAt)-Date.parse(b.requestedAt)).slice(0,8).map(row=>({id:row.id}));return send({items});
   }
   if(url.pathname==='/internal/results'&&request.method==='POST'){
    const body=await json(request,12000);if(!Array.isArray(body.items)||body.items.length>8||body.items.some(item=>!validProgress(item)))return send({error:'任务状态无效'},400);
    for(const item of body.items){
     const key='requests/'+item.id,row=await read(bucket,key);if(!row)continue;
     if(item.status==='processing'&&['done','failed'].includes(row.status)&&(!item.runId||item.runId===row.runId))continue;
     if(row.runId&&item.runId&&row.runId!==item.runId&&row.status==='processing'&&Date.now()-Date.parse(row.updatedAt||row.startedAt)<900000)continue;
     const now=new Date().toISOString(),starting=item.status==='processing'&&(row.status!=='processing'||item.runId&&row.runId!==item.runId);
     const updated={...row,status:item.status,stage:item.status==='processing'?item.stage||(row.stage!=='queued'&&row.stage)||'preparing':item.status,updatedAt:now,...(starting?{startedAt:now,attempts:(row.attempts||0)+1}:{}),...(item.status!=='processing'?{finishedAt:now}:{}),...(item.runId?{runId:item.runId}:{}),...(item.summary?{summary:{total:item.summary.total,added:item.summary.added}}:{}),...(item.dataCheckedAt?{dataCheckedAt:item.dataCheckedAt}:{}),message:item.status==='failed'?'本次补图未完成，可在相册里重试':item.status==='done'?'图库已发布':''};
     if(item.source)updated.sources={...row.sources,[item.source]:{...row.sources?.[item.source],status:item.sourceStatus||'fetching',...(item.total!==undefined?{total:item.total}:{}),...(item.newImages!==undefined?{newImages:item.newImages}:{}),updatedAt:now}};
     await write(bucket,key,updated);if(item.status==='processing')await write(bucket,'pending/'+item.id,updated);else await bucket.delete('pending/'+item.id);
    }return send({ok:true});
   }
   return send({error:'接口不存在'},404);
  }
  if(!allowed)return send({error:'仅允许 ISOLATE 网页使用'},403);
  if(url.pathname==='/api/session'&&request.method==='POST'){
   const ip=request.headers.get('cf-connecting-ip')||'shared';if(!await limited(bucket,'limits/sessions-'+await hash(ip),12))return send({error:'今天连接次数较多，请稍后重试'},429);
   const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join(''),key=await hash(token);await write(bucket,'sessions/'+key,{key,until:Date.now()+30*86400000});return send({token,expiresAt:Date.now()+30*86400000});
  }
  const body=request.method==='POST'&&['/api/requests','/api/status'].includes(url.pathname)?await json(request):null;
  const visitor=await session(request,bucket,body?.session);if(!visitor)return send({error:'请重新连接补图服务'},401);
  if(body&&(Object.keys(body).some(key=>!['id','session'].includes(key))||!validId(body.id)))return send({error:'只接收一个公开 IMDb 编号'},400);
  if(url.pathname==='/api/requests'&&request.method==='POST'){
   const key='requests/'+body.id,old=await read(bucket,key);if(old&&(old.status==='queued'||old.status==='processing'&&Date.now()-Date.parse(old.updatedAt||old.startedAt)<900000||old.status==='done'&&Date.now()-Date.parse(old.finishedAt)<3600000))return send(await publicState(old,bucket));
   if(!await limited(bucket,'limits/device-'+visitor.key,30)||!await limited(bucket,'limits/all',100))return send({error:'今天补图条目较多，请明天继续'},429);
   const row={id:body.id,status:'queued',stage:'queued',requestedAt:new Date().toISOString(),attempts:0};await write(bucket,key,row);await write(bucket,'pending/'+body.id,row);return send(await publicState(row,bucket),202);
  }
  const id=url.pathname.match(/^\/api\/requests\/((?:tt|nm)\d{5,12})$/)?.[1]||(url.pathname==='/api/status'?body?.id:null);if(id&&(request.method==='GET'||url.pathname==='/api/status'&&request.method==='POST')){const row=await read(bucket,'requests/'+id);return row?send(await publicState(row,bucket)):send({id,status:'missing'});}
  return send({error:'接口不存在'},404);
 }catch(error){return send({error:error instanceof SyntaxError?'请求格式无效':'补图服务暂时无法处理，请稍后重试'},error instanceof SyntaxError?400:503);}
}};
