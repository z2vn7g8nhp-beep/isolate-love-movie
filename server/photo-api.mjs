// Anonymous, read-only image retrieval. No user notes, cookies or collection lists are accepted.
const SOURCE_NAMES={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
const ORIGIN='https://z2vn7g8nhp-beep.github.io';
const IMAGE_HOST=/^(m\.media-amazon\.com|i\.pinimg\.com|img\d*\.doubanio\.com)$/;
const cache=new Map(),pending=new Map(),visitors=new Map();
const BATCH=12;
const UA='Mozilla/5.0 (compatible; IsolatePhotoReader/1.0; personal film catalogue)';
export class SourceError extends Error{constructor(message,status='unavailable'){super(message);this.status=status;}}
const text=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim().slice(0,220);
const decode=value=>String(value||'').replace(/&amp;/g,'&').replaceAll('\\/','/');
function imageUrl(value){try{const u=new URL(decode(value));return u.protocol==='https:'&&IMAGE_HOST.test(u.hostname)?u.href:'';}catch{return '';}}
function unique(images){const seen=new Set();return images.filter(image=>image.url&&!seen.has(image.url)&&seen.add(image.url));}
export function encodeCursor(value){return value?Buffer.from(JSON.stringify(value)).toString('base64url'):null;}
export function decodeCursor(value){if(!value)return null;if(value.length>3000||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('分页标识无效');try{return JSON.parse(Buffer.from(value,'base64url').toString());}catch{throw Error('分页标识无效');}}
export function validateQuery(params){
 const source=params.get('source');if(!SOURCE_NAMES[source])throw Error('未知图片来源');
 const id=params.get('id')||'',kind=params.get('kind')||'film',title=text(params.get('title'));
 if(!['film','series','person','character'].includes(kind)||!title||title.length>180)throw Error('档案参数无效');
 if(id&&!/^(tt|nm)\d+$/.test(id))throw Error('IMDb 标识无效');
 const douban=params.get('douban')||'';if(douban&&!/^\d{3,20}$/.test(douban))throw Error('豆瓣标识无效');
 const cursor=decodeCursor(params.get('after'));if(cursor&&cursor.source!==source)throw Error('分页来源不匹配');
 return {source,id,kind,title,zh:text(params.get('zh')),work:text(params.get('work')),year:/^\d{4}$/.test(params.get('year')||'')?params.get('year'):'',douban,cursor};
}
async function read(url,{signal,json=false,method='GET',body,headers={}}={}){
 const response=await fetch(url,{method,body,signal,headers:{'user-agent':UA,'accept-language':'en-US,en;q=0.8,zh-CN;q=0.6',accept:json?'application/json':'text/html,application/xhtml+xml',...headers}});
 if([401,403,429].includes(response.status))throw new SourceError('来源限制了当前请求','blocked');
 if(!response.ok)throw new SourceError('来源返回 HTTP '+response.status);
 const content=await response.text();if(content.length>7e6)throw new SourceError('来源响应过大');
 if(!json&&/captcha|challenge-platform|verify you are human|sec\.douban\.com|异常请求|访问异常/i.test(content.slice(0,100000)))throw new SourceError('来源要求验证访问','blocked');
 if(json){try{return JSON.parse(content);}catch{throw new SourceError('来源未返回可读资料');}}
 return content;
}
export function imdbImages(connection,subject){
 return unique((connection?.edges||[]).map(({node})=>{const url=imageUrl(node?.url);return {url,thumbnail:url.replace(/\._V1_.*(?=\.(?:jpg|png))/i,'._V1_QL80_UX360_'),title:text(node?.caption?.plainText)||subject.title,kind:subject.id.startsWith('nm')?'人物照片':'作品图片',source:'IMDb 相册',license:'版权归原权利人',pageUrl:node?.id?'https://www.imdb.com/'+(subject.id.startsWith('nm')?'name':'title')+'/'+subject.id+'/mediaviewer/'+node.id+'/':'https://www.imdb.com/title/'+subject.id+'/mediaindex/'};}));
}
function scriptJson(html,id){const safe=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp('<script[^>]*id=["\']'+safe+'["\'][^>]*>([\\s\\S]*?)<\\/script>','i'));if(!match)return null;try{return JSON.parse(match[1]);}catch{return null;}}
export function parseImdbHtml(html,subject){const data=scriptJson(html,'__NEXT_DATA__'),props=data?.props?.pageProps||{},record=props.mainColumnData||props.contentData||{};const id=props.aboveTheFoldData?.id||record.id;if(id&&id!==subject.id)throw new SourceError('IMDb 档案标识未匹配');return imdbImages(record.images||props.mainColumnData?.images,subject);}
async function imdb(subject,signal){
 if(!subject.id)throw new SourceError('此档案尚无对应 IMDb 标识','unmatched');
 const root=subject.id.startsWith('nm')?'name':'title',after=subject.cursor?.after;
 if(after&&typeof after!=='string')throw new SourceError('IMDb 分页标识无效');
 const query='{'+root+'(id:'+JSON.stringify(subject.id)+'){id images(first:12'+(after?',after:'+JSON.stringify(after):'')+'){edges{node{id url width height caption{plainText}}}pageInfo{endCursor hasNextPage}}}}';
 let failure;
 try{const data=await read('https://graphql.imdb.com/',{signal,json:true,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query})});const record=data.data?.[root];if(record?.id!==subject.id)throw new SourceError('IMDb 档案未匹配');const images=imdbImages(record.images,subject),page=record.images?.pageInfo;return {images,next:page?.hasNextPage&&page.endCursor?{source:'imdb',after:page.endCursor}:null};}catch(error){if(signal.aborted)throw error;failure=error;}
 if(after)throw failure;
 const html=await read('https://www.imdb.com/'+root+'/'+subject.id+'/mediaindex/',{signal});
 const images=parseImdbHtml(html,subject),offset=Number(subject.cursor?.offset)||0;
 if(!images.length)throw failure||new SourceError('没有读取到 IMDb 相册');
 return {images:images.slice(offset,offset+BATCH),next:offset+BATCH<images.length?{source:'imdb',offset:offset+BATCH}:null};
}
export function parseDoubanHtml(html,subject){
 const candidates=[];const links=/<a\b[^>]*href=["']([^"']*(?:(?:photos\/photo|personage\/\d+\/photo)\/\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
 for(const match of html.matchAll(links)){const image=match[2].match(/(?:data-original|src)=["']([^"']+)["']/i);if(!image)continue;const url=imageUrl(image[1]);if(!url||!/\/view\/photo\/(?:s|m|l|raw|xl)\/public\//.test(url))continue;const page=new URL(decode(match[1]),'https://movie.douban.com/');if(!/(^|\.)douban\.com$/.test(page.hostname))continue;candidates.push({url:url.replace(/\/view\/photo\/(s|m)\/public\//,'/view/photo/l/public/'),thumbnail:url.replace(/\/view\/photo\/(s|l|raw|xl)\/public\//,'/view/photo/m/public/'),title:subject.title+' · 豆瓣相册',kind:subject.kind==='person'?'人物照片':'作品图片',source:'豆瓣 相册',license:'版权归原权利人',pageUrl:page.href});}
 return unique(candidates);
}
async function resolveDouban(subject,signal){
 if(subject.douban)return subject.douban;
 if(!subject.id)throw new SourceError('尚未核对到对应豆瓣档案','unmatched');
 const title=subject.kind==='character'&&subject.work?subject.work:subject.title;
 const person=subject.kind==='person';
 const subTitle=String(title||'').includes(':')?String(title).split(':').slice(1).join(' ').trim():'';
 const terms=[...new Set([title,subject.zh,subject.id,subTitle].filter(Boolean))];
 const norm=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
 const names=[title,subject.zh].filter(Boolean).map(norm);
 const rexxarKind=person?'celebrity':'movie',webKind=person?'celebrity':'subject';
 const tried=new Set();let blocked=false;
 for(const term of terms){
  let suggestions;
  try{suggestions=await read('https://movie.douban.com/j/subject_suggest?q='+encodeURIComponent(term),{signal,json:true,headers:{referer:'https://movie.douban.com/'}});}
  catch(error){if(signal.aborted)throw error;if(error.status==='blocked')blocked=true;continue;}
  const candidates=(Array.isArray(suggestions)?suggestions:[]).filter(x=>/^\d+$/.test(x.id||'')&&!tried.has(x.id)&&!(person&&x.type==='movie')&&!(!person&&x.type==='celebrity')).slice(0,5);
  const exact=candidates.filter(x=>[x.title,x.sub_title].some(name=>names.includes(norm(name)))&&!person&&subject.year&&String(x.year)===String(subject.year));
  for(const candidate of candidates){
   tried.add(candidate.id);
   try{const details=await read('https://m.douban.com/rexxar/api/v2/'+rexxarKind+'/'+candidate.id,{signal,json:true,headers:{referer:'https://m.douban.com/'}});
    if(details.imdb===subject.id)return candidate.id;
    if(!person&&!details.imdb&&exact.length===1&&exact[0].id===candidate.id&&String(details.year)===String(subject.year)&&[details.original_title,details.title].some(name=>names.includes(norm(name)))&&!(subject.kind==='series'&&details.is_tv===false))return candidate.id;
   }catch(error){if(signal.aborted)throw error;if(error.status==='blocked')blocked=true;}
   try{const html=await read('https://movie.douban.com/'+webKind+'/'+candidate.id+'/',{signal});if(html.includes(subject.id))return candidate.id;}catch(error){if(signal.aborted)throw error;if(error.status==='blocked')blocked=true;}
  }
 }
 if(blocked)throw new SourceError('豆瓣暂时限制了当前请求','blocked');
 throw new SourceError('尚未核对到对应豆瓣档案','unmatched');
}
function doubanPhotoPage(photo){try{const page=new URL(photo.url);if(/^(www|movie)\.douban\.com$/.test(page.hostname)&&/\/(?:photos\/photo|personage\/\d+\/photo)\/\d+/.test(page.pathname)){page.protocol='https:';return page.href;}}catch{}return 'https://movie.douban.com/photos/photo/'+photo.id+'/';}
export function doubanJsonImages(data,subject,id){
 const migrated=subject.kind==='person'&&data.uri==='douban://douban.com/celebrity/'+id+'/photos';
 return unique((data.photos||[]).filter(photo=>/^\d+$/.test(String(photo.id))&&!photo.image?.is_animated&&(!photo.owner_uri||photo.owner_uri.endsWith('/'+id)||(migrated&&/^douban:\/\/douban\.com\/personage\/\d+$/.test(photo.owner_uri)))).map(photo=>{const url=[photo.image?.large?.url,photo.image?.normal?.url,photo.image?.small?.url,photo.image?.raw?.url].map(imageUrl).find(Boolean)||'',thumbnail=[photo.image?.normal?.url,photo.image?.small?.url].map(imageUrl).find(Boolean)||url;return {url,thumbnail,title:text(photo.description)||subject.title+' · 豆瓣相册',kind:subject.kind==='person'?'人物照片':'作品图片',source:'豆瓣 相册',license:'版权归原权利人',pageUrl:doubanPhotoPage(photo)};}));
}

async function douban(subject,signal){
 const id=subject.cursor?.douban||await resolveDouban(subject,signal),offset=Number(subject.cursor?.offset)||0;
 if(!/^\d+$/.test(String(id))||!Number.isSafeInteger(offset)||offset<0||offset>6000)throw new SourceError('豆瓣分页标识无效');
 const root=subject.kind==='person'?'celebrity':'subject';
 try{const data=await read('https://m.douban.com/rexxar/api/v2/'+(subject.kind==='person'?'celebrity':'movie')+'/'+id+'/photos?'+new URLSearchParams({start:String(offset),count:'12'}),{signal,json:true,headers:{referer:'https://m.douban.com/'}});const images=doubanJsonImages(data,subject,String(id));if(images.length)return {images,next:offset+images.length<Number(data.total)?{source:'douban',douban:id,offset:offset+images.length}:null};}catch(error){if(signal.aborted)throw error;}
 const html=await read('https://movie.douban.com/'+root+'/'+id+'/photos/?type='+(root==='subject'?'S':'C')+'&start='+offset,{signal});
 const all=parseDoubanHtml(html,subject),local=Number(subject.cursor?.local)||0,images=all.slice(local,local+BATCH);
 const nextStart=html.match(/(?:rel=["']next["'][^>]*href|href)=["'][^"']*start=(\d+)[^"']*["'][^>]*(?:rel=["']next["'])?/i);
 const moreLocal=local+BATCH<all.length;
 return {images,next:moreLocal?{source:'douban',douban:id,offset,local:local+BATCH}:all.length>=30?{source:'douban',douban:id,offset:offset+30,local:0}:nextStart&&Number(nextStart[1])>offset?{source:'douban',douban:id,offset:Number(nextStart[1]),local:0}:null};
}
export function pinterestImages(pins){return unique((Array.isArray(pins)?pins:[]).filter(pin=>/^\d+$/.test(pin.id||'')&&!pin.is_video).map(pin=>{const image=pin.images?.orig||pin.images?.['736x']||pin.images?.['564x']||pin.images?.['236x'],url=imageUrl(image?.url),thumbnail=imageUrl(pin.images?.['236x']?.url)||url;return {url,thumbnail,title:text(pin.description)||'Pinterest 搜索图片',kind:'搜索图片',source:'Pinterest 搜索',license:'版权归原权利人',pageUrl:'https://www.pinterest.com/pin/'+pin.id+'/'};}));}
function collectPinArrays(data){const pins=[];const visit=(node,depth=0)=>{if(!node||typeof node!=='object'||depth>20)return;if(Array.isArray(node)){for(const item of node)visit(item,depth+1);return;}if(node.images&&/^\d+$/.test(node.id||'')){pins.push(node);return;}for(const value of Object.values(node))visit(value,depth+1);};visit(data);return pins;}
export function parsePinterestHtml(html){return pinterestImages(collectPinArrays(scriptJson(html,'__PWS_DATA__')||scriptJson(html,'__PWS_INITIAL_PROPS__')));}
async function pinterest(subject,signal){
 const query=subject.kind==='person'?subject.title+' portrait':subject.kind==='character'?[subject.work,subject.title].filter(Boolean).join(' '):[subject.title,subject.year,'stills'].filter(Boolean).join(' ');
 const bookmark=subject.cursor?.bookmark;if(bookmark&&typeof bookmark!=='string')throw new SourceError('Pinterest 分页标识无效');
 const sourceUrl='/search/pins/?q='+encodeURIComponent(query);
 const options={query,scope:'pins',page_size:12,redux_normalize_feed:true,...(bookmark?{bookmarks:[bookmark]}:{})};
 let failure;
 try{const data=await read('https://www.pinterest.com/resource/BaseSearchResource/get/?'+new URLSearchParams({source_url:sourceUrl,data:JSON.stringify({options,context:{}})}),{signal,json:true});const response=data.resource_response;if(response?.status==='failure')throw new SourceError('Pinterest 要求登录或验证','blocked');const images=pinterestImages(response?.data?.results||response?.data),next=data.resource?.options?.bookmarks?.[0]||response?.bookmark||response?.data?.bookmark;return {images,next:next&&next!=='-end-'?{source:'pinterest',bookmark:next}:null};}catch(error){if(signal.aborted)throw error;failure=error;}
 if(bookmark)throw failure;
 const html=await read('https://www.pinterest.com'+sourceUrl,{signal});const images=parsePinterestHtml(html),offset=Number(subject.cursor?.offset)||0;
 if(!images.length)throw failure||new SourceError('没有读取到 Pinterest 搜索图片');
 return {images:images.slice(offset,offset+BATCH),next:offset+BATCH<images.length?{source:'pinterest',offset:offset+BATCH}:null};
}
const providers={imdb,douban,pinterest};
export async function retrievePhotos(subject){
 const key=JSON.stringify(subject),known=cache.get(key);if(known&&known.until>Date.now())return {...known.value,cached:true};if(pending.has(key))return pending.get(key);if(pending.size>=12)return {source:subject.source,status:'busy',images:[],nextCursor:null,message:'抓图后台正忙，请稍后继续'};
 const task=(async()=>{const signal=AbortSignal.timeout(13000);let value;try{const result=await providers[subject.source](subject,signal);value={source:subject.source,status:result.images.length?'ok':'empty',images:result.images,nextCursor:encodeCursor(result.next),message:result.images.length?'已从'+SOURCE_NAMES[subject.source]+'读取 '+result.images.length+' 张':'该站本页没有更多可读图片'};}catch(error){value={source:subject.source,status:error.status||'unavailable',images:[],nextCursor:null,message:error.name==='TimeoutError'?'来源响应超时，请稍后重试':error.message||'来源暂不可用'};}cache.set(key,{value,until:Date.now()+(value.status==='ok'?3600000:30000)});while(cache.size>200)cache.delete(cache.keys().next().value);return {...value,fetchedAt:new Date().toISOString()};})();
 pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
function allowedRate(ip){const now=Date.now(),known=visitors.get(ip);if(!known||known.until<now){visitors.set(ip,{n:1,until:now+60000});while(visitors.size>500)visitors.delete(visitors.keys().next().value);return true;}return ++known.n<=30;}
export async function retrievePhotoPages(subject,{pages=1,retrieve=retrievePhotos}={}){
 let result=await retrieve(subject);const images=[...(result.images||[])];
 for(let page=1;page<Math.max(1,Math.min(3,pages))&&result.nextCursor&&result.images?.length;page++){
  const next=await retrieve({...subject,cursor:decodeCursor(result.nextCursor)});if(!next.images?.length)break;
  result=next;images.push(...next.images);
 }
 return {...result,images:unique(images)};
}
export async function handlePhotoRequest(request){
 const url=new URL(request.url),origin=request.headers.get('origin');const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':origin===ORIGIN||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||'')?origin:ORIGIN,'vary':'Origin'};
 const send=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&origin!==ORIGIN&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return send({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Content-Type'}});
 if(request.method!=='GET')return send({error:'Method not allowed'},405);
 if(url.pathname==='/health')return send({ok:true,service:'isolate-photo-reader',sources:Object.keys(SOURCE_NAMES)});
 if(url.pathname!=='/v1/photos')return send({error:'Not found'},404);
 if(!allowedRate(request.headers.get('x-forwarded-for')?.split(',')[0]||'anonymous'))return send({error:'请求较多，请稍后继续'},429);
 try{const subject=validateQuery(url.searchParams);return send(await retrievePhotos(subject));}catch(error){return send({error:error.message||'参数无效'},400);}
}
if(globalThis.Bun&&import.meta.main)Bun.serve({port:Number(Bun.env.PORT||8080),fetch:handlePhotoRequest});
