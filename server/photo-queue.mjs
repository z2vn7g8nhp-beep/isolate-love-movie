// A bounded queue for public IMDb identifiers. No GitHub token or private record is accepted.
const WEB_ORIGIN='https://z2vn7g8nhp-beep.github.io';
const validId=id=>/^(tt|nm)\d{5,12}$/.test(id||'');
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const read=async(bucket,key)=>{const object=await bucket.get(key);return object?object.json():null;};
const write=(bucket,key,data)=>bucket.put(key,JSON.stringify(data),{httpMetadata:{contentType:'application/json'}});
async function limited(bucket,key,max){const now=Date.now(),old=await read(bucket,key),row=old&&old.until>now?old:{count:0,until:now+86400000};if(row.count>=max)return false;await write(bucket,key,{...row,count:row.count+1});return true;}
async function json(request){if(Number(request.headers.get('content-length'))>600)throw Error('请求过大');const body=await request.text();if(body.length>600)throw Error('请求过大');return JSON.parse(body);}
async function session(request,bucket,supplied){const token=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]||supplied;if(!/^[a-f0-9]{64}$/.test(token||''))return null;const row=await read(bucket,'sessions/'+await hash(token));return row&&row.until>Date.now()?row:null;}
const publicState=row=>({id:row.id,status:row.status,requestedAt:row.requestedAt,finishedAt:row.finishedAt||null,message:row.message||''});
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
 const url=new URL(request.url),origin=request.headers.get('origin'),allowed=origin===WEB_ORIGIN||env.ALLOW_LOCAL==='1'&&/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin||'');
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin',...(allowed?{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type'}:{})};
 const send=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers});
 if(request.method==='GET'&&url.pathname==='/health')return send({service:'isolate-photo-queue',version:1});
 const bucket=env.BUCKET;if(!bucket)return send({error:'队列存储尚未启用'},503);
 try{
  if(url.pathname.startsWith('/internal/')){
   const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!(env.CRAWL_KEY&&bearer===env.CRAWL_KEY)&&!await verifyCollectorToken(bearer))return send({error:'需要采集权限'},401);
   if(url.pathname==='/internal/pending'&&request.method==='GET'){
    const objects=await bucket.list({prefix:'pending/',limit:200}),rows=await Promise.all(objects.objects.map(object=>read(bucket,object.key)));
    const items=rows.filter(row=>row&&(row.status==='queued'||row.status==='processing'&&Date.now()-Date.parse(row.startedAt)>900000)&&row.attempts<3).sort((a,b)=>Date.parse(a.requestedAt)-Date.parse(b.requestedAt)).slice(0,8).map(row=>({id:row.id}));return send({items});
   }
   if(url.pathname==='/internal/results'&&request.method==='POST'){
    const body=await json(request);if(!Array.isArray(body.items)||body.items.length>8)return send({error:'任务清单无效'},400);
    for(const item of body.items){if(!validId(item.id)||!['processing','done','failed'].includes(item.status))return send({error:'任务状态无效'},400);const key='requests/'+item.id,row=await read(bucket,key);if(!row)continue;const updated={...row,status:item.status,...(item.status==='processing'?{startedAt:new Date().toISOString(),attempts:(row.attempts||0)+1}:{finishedAt:new Date().toISOString()}),message:item.status==='failed'?'本次补图未完成，可在相册里重试':item.status==='done'?'图库已更新，可继续读取':''};await write(bucket,key,updated);if(item.status==='processing')await write(bucket,'pending/'+item.id,updated);else await bucket.delete('pending/'+item.id);}return send({ok:true});
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
   const key='requests/'+body.id,old=await read(bucket,key);if(old&&(old.status==='queued'||old.status==='processing'&&Date.now()-Date.parse(old.startedAt)<900000||old.status==='done'&&Date.now()-Date.parse(old.finishedAt)<3600000))return send(publicState(old));
   if(!await limited(bucket,'limits/device-'+visitor.key,30)||!await limited(bucket,'limits/all',100))return send({error:'今天补图条目较多，请明天继续'},429);
   const row={id:body.id,status:'queued',requestedAt:new Date().toISOString(),attempts:0};await write(bucket,key,row);await write(bucket,'pending/'+body.id,row);return send(publicState(row),202);
  }
  const id=url.pathname.match(/^\/api\/requests\/((?:tt|nm)\d{5,12})$/)?.[1]||(url.pathname==='/api/status'?body?.id:null);if(id&&(request.method==='GET'||url.pathname==='/api/status'&&request.method==='POST')){const row=await read(bucket,'requests/'+id);return row?send(publicState(row)):send({id,status:'missing'});}
  return send({error:'接口不存在'},404);
 }catch(error){return send({error:error instanceof SyntaxError?'请求格式无效':'补图服务暂时无法处理，请稍后重试'},error instanceof SyntaxError?400:503);}
}};
