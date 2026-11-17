const IMDbOrigin='https://sg.media-imdb.com';
const WikiOrigin='https://www.wikidata.org/w/api.php';
export function imdbQuery(input){const q=String(input).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120);if(!q)throw Error('请使用英文名或 IMDb ID；中文名由 Wikidata 匹配');return q;}
export function fromImdb(d,fetchedAt=new Date().toISOString()){return {id:d.id,title:d.l,kind:d.id.startsWith('nm')?'person':/tv|series/i.test(d.qid||d.q||'')?'series':'film',year:d.y||null,subtitle:d.s||'',image:Array.isArray(d.i)?d.i[0]:d.i?.imageUrl||'',source:'IMDb',fetchedAt};}
const pending=new Map(),cache=new Map();
function abortable(promise,signal){if(!signal)return promise;if(signal.aborted)return Promise.reject(signal.reason||new DOMException('已取消','AbortError'));return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||new DOMException('已取消','AbortError'));signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
export function imdbSearch(query,{signal,document:doc=globalThis.document,scope=globalThis}={}){let q;try{q=imdbQuery(query);}catch(e){return Promise.reject(e);}if(cache.get(q)?.until>Date.now())return abortable(Promise.resolve(cache.get(q).items),signal);if(pending.has(q))return abortable(pending.get(q),signal);
const promise=new Promise((resolve,reject)=>{const callback='imdb$'+q,script=doc.createElement('script');let timer;const cleanup=()=>{clearTimeout(timer);script.remove();delete scope[callback];pending.delete(q);};scope[callback]=data=>{try{const items=(data.d||[]).filter(x=>/^(tt|nm)\d+$/.test(x.id)).map(x=>fromImdb(x));if(cache.size>100)cache.delete(cache.keys().next().value);cache.set(q,{items,until:Date.now()+300000});resolve(items);}catch(e){reject(e);}finally{cleanup();}};script.src=IMDbOrigin+'/suggests/'+q[0]+'/'+encodeURIComponent(q)+'.json';script.async=true;script.referrerPolicy='no-referrer';script.onerror=()=>{cleanup();reject(Error('IMDb 搜索暂不可用'));};timer=setTimeout(()=>{cleanup();reject(Error('IMDb 搜索超时'));},10000);doc.head.append(script);});pending.set(q,promise);return abortable(promise,signal);}
async function wikiRequest(params,signal){const url=new URL(WikiOrigin);url.search=new URLSearchParams({...params,format:'json',origin:'*'});const r=await fetch(url,{signal:signal||AbortSignal.timeout(12000),credentials:'omit'});if(!r.ok)throw Error('Wikidata 暂不可用');const d=await r.json();if(d.error)throw Error('Wikidata 返回错误');return d;}
async function wikiSearch(query,signal){const d=await wikiRequest({action:'wbsearchentities',search:query,language:/[\u3400-\u9fff]/.test(query)?'zh':'en',uselang:'zh',limit:'6'},signal);return d.search||[];}
const claim=(e,p)=>e?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
export function wikiFields(entity){const zh=entity.labels?.['zh-cn']?.value||entity.labels?.zh?.value||entity.labels?.['zh-hans']?.value||entity.labels?.['zh-tw']?.value||entity.labels?.['zh-hk']?.value||entity.labels?.['zh-hant']?.value;const douban=claim(entity,'P4529')||claim(entity,'P5284');return {wikidata:entity.id,...(zh?{zh}:{}),...(douban?{douban}:{} )};}
async function entities(ids,signal){if(!ids.length)return[];const d=await wikiRequest({action:'wbgetentities',ids:ids.join('|'),props:'labels|claims|descriptions|sitelinks',sitefilter:'enwiki|zhwiki',languages:'zh-cn|zh|zh-hans|zh-tw|zh-hk|zh-hant|en|mul'},signal);return Object.values(d.entities||{});}
async function wikiByImdb(id,signal){try{const found=await wikiRequest({action:'query',list:'search',srsearch:'haswbstatement:P345='+id,srnamespace:'0',srlimit:'5'},signal);const ids=(found.query?.search||[]).map(x=>x.title).filter(x=>/^Q\d+$/.test(x));if(!ids.length)return null;return (await entities(ids,signal)).find(x=>claim(x,'P345')===id)||null;}catch(e){if(signal?.aborted)throw e;return null;}}
export async function search(query,type='all',{signal}={}){const q=query.trim();if(!q||q.length>150)throw Error('请输入不超过 150 字的关键词');const chinese=/[\u3400-\u9fff]/.test(q);let items=[],source='IMDb',warning;
if(!chinese)try{items=await imdbSearch(q,{signal});}catch(e){if(signal?.aborted)throw e;warning='IMDb 暂不可用，尝试 Wikidata 关联';}
if(chinese||!items.length){try{const results=await wikiSearch(q,signal),es=await entities(results.map(x=>x.id),signal);const linked=es.filter(e=>/^(tt|nm)\d+$/.test(claim(e,'P345')||''));const fetched=await Promise.allSettled(linked.slice(0,5).map(async e=>{const id=claim(e,'P345');const matches=await imdbSearch(id,{signal});const item=matches.find(x=>x.id===id);return item?{...item,...wikiFields(e)}:null;}));for(const r of fetched)if(r.status==='fulfilled'&&r.value){const index=items.findIndex(x=>x.id===r.value.id);if(index>=0)items[index]={...items[index],...r.value};else items.push(r.value);}source='IMDb + Wikidata';if(!items.length&&linked.length)warning='IMDb 暂不可用，请稍后重试';else if(items.length)warning=undefined;}catch(e){if(signal?.aborted)throw e;warning=items.length?'Wikidata 暂不可用，显示 IMDb 结果':'数据源暂不可用，请稍后重试';}}
if(type==='person')items=items.filter(x=>x.kind==='person');else if(type==='title')items=items.filter(x=>x.kind!=='person');return {items,source,warning,fetchedAt:new Date().toISOString()};}
export async function detail(id,title,{signal}={}){if(!/^(tt|nm)\d+$/.test(id))throw Error('IMDb 标识无效');let e=await wikiByImdb(id,signal);if(!e){const result=await wikiSearch(title||id,signal);const es=await entities(result.map(x=>x.id),signal);e=es.find(x=>claim(x,'P345')===id);}return {item:e?wikiFields(e):{},...(!e?{warning:'未找到可核对的 Wikidata 关联，保留 IMDb 档案'}:{}),fetchedAt:new Date().toISOString()};}
export async function pagesApi(path,options={}){const url=new URL(path,'https://isolate.invalid/'),signal=options.signal;if(url.pathname==='/search')return search(url.searchParams.get('q')||'',url.searchParams.get('type')||'all',{signal});if(url.pathname==='/detail')return detail(url.searchParams.get('id'),url.searchParams.get('title'),{signal});if(url.pathname==='/library')return {available:false,records:{}};if(url.pathname==='/refresh'){const r=await fetch('./catalog.json?updated='+Date.now(),{cache:'no-store',signal:signal||AbortSignal.timeout(15000)});if(!r.ok)throw Error('目录更新暂不可用');const catalog=await r.json();const ids=catalog.filter(x=>['film','series'].includes(x.kind)).slice(0,6).map(x=>x.id);const refreshed=await Promise.allSettled(ids.map(id=>imdbSearch(id,{signal})));const items=new Map(catalog.map(x=>[x.id,x]));let count=0;refreshed.forEach((r,i)=>{const item=r.status==='fulfilled'?r.value.find(x=>x.id===ids[i]):null;if(item){items.set(item.id,{...items.get(item.id),...item});count++;}});return {items:[...items.values()],fetchedAt:new Date().toISOString(),warning:count<ids.length?'已更新公开目录；部分 IMDb 数据暂不可用':undefined};}throw Error('静态版不支持此操作');}

function wikiDate(value) {
  if (!value?.time || !/^\+\d{4}/.test(value.time)) return '';
  const date=value.time.slice(1,11);
  return value.precision>=11?date:value.precision===10?date.slice(0,7):date.slice(0,4);
}
const values=(entity,property)=>(entity.claims?.[property]||[]).filter(x=>x.rank!=='deprecated').map(x=>x.mainsnak?.datavalue?.value).filter(x=>x!=null);
const entityId=value=>value?.id;
const unique=list=>[...new Set(list.filter(Boolean))];
export function describeEntity(entity,lookup={}) {
  const label=id=>lookup[id]?.labels?.['zh-cn']?.value||lookup[id]?.labels?.zh?.value||lookup[id]?.labels?.['zh-hans']?.value||lookup[id]?.labels?.['zh-tw']?.value||lookup[id]?.labels?.['zh-hk']?.value||lookup[id]?.labels?.en?.value||lookup[id]?.labels?.mul?.value||'';
  const labels=prop=>unique(values(entity,prop).map(v=>label(entityId(v))));
  const facts=[];
  const add=(key,value)=>{if(Array.isArray(value)&&!value.length)return;if(value)facts.push({label:key,value:Array.isArray(value)?value.join(' · '):String(value)});};
  const person=values(entity,'P31').some(x=>x.id==='Q5');
  if(person){add('出生日期',wikiDate(values(entity,'P569')[0]));add('出生地',labels('P19'));add('国籍',labels('P27'));add('职业',labels('P106'));add('出生姓名',values(entity,'P1477')[0]?.text);add('使用语言',labels('P1412'));add('教育经历',labels('P69'));const height=values(entity,'P2048')[0];if(height?.amount){if(height.unit?.endsWith('/Q174728'))add('身高',Number(height.amount)+' 厘米');else if(height.unit?.endsWith('/Q11573'))add('身高',Number(height.amount)+' 米');}}
  else {add('上映 / 首播',unique(values(entity,'P577').map(wikiDate)).slice(0,4));const duration=values(entity,'P2047')[0];if(duration?.amount){const amount=Number(duration.amount);if(duration.unit?.endsWith('/Q7727'))add('片长',`${amount} 分钟`);else if(duration.unit?.endsWith('/Q11574'))add('片长',`${Math.round(amount/60)} 分钟`);}add('类型',labels('P136'));add('制作国家 / 地区',labels('P495'));add('原始语言',labels('P364'));add('集数',values(entity,'P1113')[0]?.amount?.replace(/^\+/,''));add('季数',values(entity,'P2437')[0]?.amount?.replace(/^\+/,''));add('系列',labels('P179'));add('改编自',labels('P144'));}
  const credits=[];
  for(const [property,role] of person?[['P800','代表作品']]:[['P57','导演'],['P58','编剧'],['P161','演员'],['P86','配乐'],['P344','摄影'],['P1040','剪辑'],['P162','制片人']]) {
    for(const value of values(entity,property).slice(0,property==='P161'?32:16)) {const e=lookup[entityId(value)];if(!e)continue;const title=e.labels?.en?.value||e.labels?.mul?.value||label(e.id);const zh=e.labels?.['zh-cn']?.value||e.labels?.zh?.value||e.labels?.['zh-hans']?.value||e.labels?.['zh-tw']?.value||e.labels?.['zh-hk']?.value||'';const imdb=claim(e,'P345');const img=claim(e,'P18');const statement=(entity.claims?.[property]||[]).find(x=>x.mainsnak?.datavalue?.value?.id===e.id);const character=property==='P161'?[(statement?.qualifiers?.P4633||[]).map(x=>x.datavalue?.value).filter(x=>typeof x==='string').join(' / '),(statement?.qualifiers?.P453||[]).map(x=>label(x.datavalue?.value?.id)).filter(Boolean).join(' / ')].filter(Boolean).join(' / '):'';credits.push({title,zh,role,character,wikidata:e.id,...(/^(tt|nm)\d+$/.test(imdb||'')?{id:imdb,kind:imdb.startsWith('nm')?'person':'film'}:{}),...(typeof img==='string'?{image:'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(img)+'?width=500'}:{})});}
  }
  const awards=labels('P166').slice(0,8);if(awards.length)add('获奖记录',awards);
  const description=entity.descriptions?.['zh-cn']?.value||entity.descriptions?.zh?.value||entity.descriptions?.['zh-hans']?.value||entity.descriptions?.['zh-tw']?.value||entity.descriptions?.['zh-hk']?.value||entity.descriptions?.en?.value||'';
  return {facts,credits,description,birthday:person?wikiDate(values(entity,'P569')[0]):''};
}
export async function dossier(id,title,{wikidata,signal}={}) {
  if(!/^(tt|nm)\d+$/.test(id))throw Error('IMDb 标识无效');
  let candidates=[];
  if(/^Q\d+$/.test(wikidata||''))candidates=await entities([wikidata],signal);
  let entity=candidates.find(x=>claim(x,'P345')===id);
  if(!entity)entity=await wikiByImdb(id,signal);
  if(!entity){const found=await wikiSearch(title||id,signal);candidates=await entities(found.map(x=>x.id),signal);entity=candidates.find(x=>claim(x,'P345')===id);}
  if(!entity)return {item:{},facts:[],credits:[],warning:'没有找到可核对的辅助档案。可继续记录你的收藏信息。',fetchedAt:new Date().toISOString()};
  const props=['P19','P27','P106','P136','P495','P364','P57','P58','P161','P86','P800','P166','P1412','P69','P179','P144','P344','P1040','P162'];
  const roleIds=(entity.claims?.P161||[]).slice(0,32).flatMap(x=>(x.qualifiers?.P453||[]).map(q=>q.datavalue?.value?.id));const ids=unique([...props.flatMap(prop=>values(entity,prop).slice(0,prop==='P161'?32:16).map(entityId)),...roleIds]).slice(0,130),lookup={};
  for(let offset=0;offset<ids.length;offset+=40){const batch=await entities(ids.slice(offset,offset+40),signal);for(const e of batch)lookup[e.id]=e;}
  return {version:4,item:wikiFields(entity),...describeEntity(entity,lookup),wikiImages:values(entity,'P18').filter(x=>typeof x==='string').slice(0,6),wikiArticle:entity.sitelinks?.enwiki?.title||'',wikiArticleZh:entity.sitelinks?.zhwiki?.title||'',fetchedAt:new Date().toISOString(),source:'Wikidata',sourceUrl:'https://www.wikidata.org/wiki/'+entity.id};
}
export async function refreshOwned(items,{signal}={}) {
  const results=[];let failed=0;
  for(let offset=0;offset<items.length;offset+=3){const batch=await Promise.allSettled(items.slice(offset,offset+3).map(async item=>{if(!/^(tt|nm)\d+$/.test(item.id))return item;const found=await imdbSearch(item.id,{signal});return found.find(x=>x.id===item.id)||item;}));for(const result of batch)if(result.status==='fulfilled')results.push(result.value);else failed++;}
  return {items:results,failed,fetchedAt:new Date().toISOString()};
}

export function plainMetadata(value) {
  return String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,500);
}
const cleanWikiUrl=raw=>{try{const parsed=new URL(raw);for(const key of [...parsed.searchParams.keys()])if(key.startsWith('utm_'))parsed.searchParams.delete(key);return parsed.href;}catch{return '';}};
export function commonsImages(data) {
  return Object.values(data?.query?.pages||{}).map(page=>{
    const info=page.imageinfo?.[0],meta=info?.extmetadata||{};
    if(!info)return null;const photographic=info.mime?/^image\/(jpeg|png|webp)$/.test(info.mime):/\.(jpe?g|png|webp)$/i.test(page.title||'');if(!photographic)return null;
    const url=cleanWikiUrl(info.url||info.thumburl),thumb=cleanWikiUrl(info.thumburl);if(!url)return null;return {url,thumbnail:thumb||url,title:plainMetadata(page.title?.replace(/^File:/,'')),source:'Wikimedia Commons',author:plainMetadata(meta.Artist?.value),license:plainMetadata(meta.LicenseShortName?.value),pageUrl:info.descriptionurl||'https://commons.wikimedia.org/wiki/'+encodeURIComponent(page.title)};
  }).filter(Boolean).filter(image=>/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(image.url||''));
}
export async function fetchGallery(item,data={}, {signal,offset=0}={}) {
  const images=[];let nextOffset=null,failed=false;
  if(!offset){
    if(item.image)images.push({url:item.image,title:item.kind==='character'?'饰演者肖像':'IMDb 主图',kind:['film','series'].includes(item.kind)?'海报':'肖像',source:item.source||'IMDb',license:'版权归原权利人',pageUrl:/^(tt|nm)\d+$/.test(item.id)?'https://www.imdb.com/'+(item.id.startsWith('nm')?'name':'title')+'/'+item.id+'/':''});
    if(item.id?.startsWith('tt'))images.push({url:'https://images.metahub.space/background/medium/'+item.id+'/img',title:'作品背景图',kind:'背景图',source:'MetaHub · IMDb 作品标识关联',license:'版权归原权利人',pageUrl:'https://www.imdb.com/title/'+item.id+'/'});
  }
  const wiki=data.item?.wikidata||item.wikidata;
  if(/^Q\d+$/.test(wiki||'')){
    try{
      const params={action:'query',generator:'search',gsrsearch:'haswbstatement:P180='+wiki+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'12',gsroffset:String(offset),prop:'imageinfo',iiprop:'url|mime|extmetadata',iiurlwidth:'480',format:'json',origin:'*'};
      const response=await fetch('https://commons.wikimedia.org/w/api.php?'+new URLSearchParams(params),{signal:signal||AbortSignal.timeout(15000),credentials:'omit'});
      if(!response.ok)throw Error('Commons unavailable');const body=await response.json();if(body.error)throw Error('Commons unavailable');
      images.push(...commonsImages(body));nextOffset=body.continue?.gsroffset??null;
    }catch(e){if(signal?.aborted)throw e;failed=true;nextOffset=offset;}
  }
  if(!offset)for(const file of data.wikiImages||[]){const url='https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(file)+'?width=960';if(!images.some(x=>decodeURIComponent(x.url).includes(file.replaceAll(' ','_'))))images.push({url,thumbnail:url.replace('width=960','width=330'),title:file,source:'Wikidata 指定配图',license:'授权见原图来源',pageUrl:'https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file)});}
  const used=new Set();return {images:images.filter(image=>!used.has(image.url)&&used.add(image.url)),nextOffset,failed,fetchedAt:new Date().toISOString()};
}
