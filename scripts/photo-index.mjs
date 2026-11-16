const sources={imdb:{page:/(^|\.)imdb\.com$/,image:/^m\.media-amazon\.com$/},douban:{page:/(^|\.)douban\.com$/,image:/^img\d*\.doubanio\.com$/},pinterest:{page:/(^|\.)pinterest\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2})$/i,image:/^i\.pinimg\.com$/}};
const names={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
const decode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const stop=new Set(['the','and','for','with','from','into','part','vol']);
const titleWords=s=>(String(s||'').toLowerCase().match(/[a-z]{3,}/g)||[]).filter(w=>!stop.has(w));
function titleMatches(text,page,source,item,exactId){
 if(exactId)return true;
 const n=normalize(text),title=normalize(item.title),zh=normalize(item.zh);
 const altTitle=normalize(String(item.title||'').replaceAll('&',' and '));
 if(title&&n.includes(title)||altTitle&&n.includes(altTitle)||zh&&n.includes(zh))return true;
 const parts=String(item.title||'').split(/[:\-–—]/).map(s=>s.trim()).filter(Boolean);
 if(parts.length>1){
  const sub=parts.slice(1).join(' '),subNorm=normalize(sub),subAlt=normalize(sub.replaceAll('&',' and ')),subWords=titleWords(sub);
  if(subWords.length>=2&&!/^(part|chapter)(one|two|three|four|five|\d+)$/.test(subNorm)&&(subNorm.length>=8&&n.includes(subNorm)||subAlt.length>=8&&n.includes(subAlt)))return true;
 }
 if(source==='pinterest'){
  let path=page.pathname;try{path=decodeURIComponent(path);}catch{}
  const slug=path.split('--')[0].replace(/\/pin\//,' '),pinText=normalize(text+' '+slug);
  if(title&&pinText.includes(title)||altTitle&&pinText.includes(altTitle)||zh&&pinText.includes(zh))return true;
  const rawWords=String(item.title||'').toLowerCase().match(/[a-z]{3,}/g)||[],sig=rawWords.filter(w=>!stop.has(w));
  if(rawWords.length>=2&&rawWords.every(word=>pinText.includes(word)))return true;
  if(sig.length>=3&&sig.filter(word=>pinText.includes(word)).length>=Math.max(3,Math.ceil(sig.length*0.65)))return true;
 }
 return false;
}
export function matchesPhotoSubject(pageUrl,caption,source,item){
 try{const page=new URL(pageUrl),id=page.pathname.match(/\/(?:title|name)\/((?:tt|nm)\d+)(?:\/|$)/)?.[1];
  if(source==='imdb'&&id&&id!==item.id)return false;
  if(source==='imdb'&&id===item.id)return true;
  const release=String(caption||'').match(/\(((?:19|20)\d{2})\)/)?.[1];if(item.year&&release&&Number(release)!==Number(item.year)&&!String(item.title).includes(release))return false;
  return true;
 }catch{return false;}
}
function parseImageIndexDetailed(html,source,item){
 const rule=sources[source];if(!rule)return{result:[],reasons:{},samples:[]};const result=[],seen=new Set(),reasons={},samples=[];
 const bump=(reason,row)=>{reasons[reason]=(reasons[reason]||0)+1;if(samples.length<3&&row)samples.push({reason,purl:String(row.purl||'').slice(0,90),murl:String(row.murl||'').slice(0,70),t:String(row.t||'').slice(0,60)});};
 for(const match of html.matchAll(/\bm=("[^"]*"|'[^']*')/g))try{
  const row=JSON.parse(decode(match[1].slice(1,-1))),image=new URL(row.murl),page=new URL(row.purl);
  if(!['https:','http:'].includes(image.protocol)||page.protocol!=='https:'){bump('proto',row);continue;}
  if(!rule.image.test(image.hostname)){bump('imgHost:'+image.hostname,row);continue;}
  if(!rule.page.test(page.hostname)){bump('pageHost:'+page.hostname,row);continue;}
  image.protocol='https:';const caption=decode(row.t||row.desc||'');if(!matchesPhotoSubject(page.href,caption,source,item)){bump('yearOrId',row);continue;}
  const imdbId=source==='imdb'?page.pathname.match(/\/(?:title|name)\/((?:tt|nm)\d+)(?:\/|$)/)?.[1]:'';
  const exactId=source==='imdb'&&imdbId===item.id;
  if(!titleMatches(caption+' '+(row.desc||''),page,source,item,exactId)){bump('title',row);continue;}
  if(/\.gif(?:$|\?)/i.test(image.href)){bump('gif',row);continue;}
  if(seen.has(image.href)){bump('dup',row);continue;}seen.add(image.href);
  let thumbnail=image.href;
  if(source==='imdb')thumbnail=image.href.replace(/\._V1_.*(?=\.(?:jpg|png))/i,'._V1_QL80_UX360_');
  if(source==='douban')thumbnail=image.href.replace(/\/view\/photo\/(l|raw|xl)\/public\//,'/view/photo/m/public/');
  if(source==='pinterest'){thumbnail=image.href.replace(/\/(originals|736x|564x)\//,'/236x/');const pin=page.pathname.match(/\/pin\/(?:[^/]*--)?(\d+)\/?/);if(!pin){bump('noPin',row);continue;}page.href='https://www.pinterest.com/pin/'+pin[1]+'/';}
  result.push({url:image.href,thumbnail,title:caption.slice(0,200)||item.title,kind:'搜索图片',source:names[source]+' · 搜索索引',license:'版权归原权利人',pageUrl:page.href,retrievedVia:'public-image-index'});
 }catch{bump('parse');}
 return {result,reasons,samples};
}
export function parseImageIndex(html,source,item){return parseImageIndexDetailed(html,source,item).result;}
export async function indexedPhotos(source,item,{first=1,signal,fetcher=fetch}={}){
 const scope={imdb:'imdb.com',douban:'movie.douban.com',pinterest:'pinterest.com'}[source];
 if(!scope)throw Error('未知图片来源');
 const title=source==='douban'?(item.zh||item.title):item.title;
 // Punctuation in a title (notably ':') and an over-specific site path can
 // produce unrelated fallback results. Try a bounded, quoted title as well.
 const clean=s=>String(s||'').replaceAll('&',' and ').replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
 const phrase=String(title||'').replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
 const enPhrase=clean(item.title);
 const subPhrase=String(item.title||'').includes(':')?clean(String(item.title).split(':').slice(1).join(' ')):String(item.title||'').includes('&')?enPhrase:'';
 const root=item.kind==='person'?'name':'title';
 const queries=[
  `"${phrase}" site:${scope}`,
  'site:'+scope+(source==='imdb'?'/'+root+'/'+item.id:'')+' '+title,
  ...(source==='imdb'?[`site:imdb.com/${root}/${item.id} mediaviewer`]:[]),
  ...(source==='douban'&&item.zh&&enPhrase&&enPhrase!==phrase?[`"${enPhrase}" site:${scope}`]:[]),
  ...(source==='pinterest'&&subPhrase&&subPhrase.length>=6?[`"${subPhrase}" site:${scope}`]:[]),
  ...(source==='pinterest'?[`"${enPhrase}" ${item.kind==='person'?'portrait':'poster'} site:pinterest.com`]:[])
 ];
 let failure;
 for(const [attempt,query]of [...new Set(queries)].entries()){
  try{
   const url='https://www.bing.com/images/search?'+new URLSearchParams({q:query,first:String(attempt?1:first),count:'35',adlt:'strict'});
   const response=await fetcher(url,{signal:signal||AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36','accept-language':'en-US,en;q=0.8,zh-CN;q=0.6'}});
   if(!response.ok)throw Error('公开图片索引返回 '+response.status);
   const html=await response.text(),{result:images,reasons,samples}=parseImageIndexDetailed(html,source,item);console.log(JSON.stringify({stage:'index',source,subject:item.id,attempt:attempt+1,bytes:html.length,records:(html.match(/murl/g)||[]).length,matched:images.length,...(!images.length?{reasons,samples}:{})}));
   if(images.length)return images;
  }catch(error){if(signal?.aborted)throw error;failure=error;}
 }
 if(failure)throw failure;return [];
}

// The anonymous suggestion endpoint returns a single verified primary image,
// even when the separate IMDb gallery is unavailable. It is not a gallery API.
export async function imdbPrimaryPhotos(item,{signal,fetcher=fetch}={}){
 if(!/^(tt|nm)\d{5,12}$/.test(item.id||''))throw Error('IMDb 标识无效');
 const response=await fetcher('https://v3.sg.media-imdb.com/suggestion/'+item.id[0]+'/'+item.id+'.json',{signal:signal||AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('IMDb 公开资料返回 '+response.status);
 const data=await response.json(),record=data.d?.find(row=>row.id===item.id);
 let url;try{url=new URL(record?.i?.imageUrl);}catch{return [];}
 if(url.protocol!=='https:'||url.hostname!=='m.media-amazon.com'||url.username||url.password)return [];
 return [{url:url.href,thumbnail:url.href.replace(/\._V1_.*(?=\.(?:jpg|png))/i,'._V1_QL80_UX360_'),title:record.l||item.title,kind:item.id.startsWith('nm')?'人物肖像':'作品海报',source:'IMDb 公开主图',license:'版权归原权利人',pageUrl:'https://www.imdb.com/'+(item.id.startsWith('nm')?'name':'title')+'/'+item.id+'/',retrievedVia:'public-metadata'}];
}

// Public Pin widgets may expose a complete board dedicated to the same subject.
export async function enrichPinterest(images,item,{signal,fetcher=fetch}={}){
 const ids=[...new Set(images.map(image=>image.pageUrl?.match(/\/pin\/(\d+)/)?.[1]).filter(Boolean))].slice(0,12);if(!ids.length)return[];
 const read=async path=>{const r=await fetcher('https://widgets.pinterest.com/v3/pidgets/'+path,{signal:signal||AbortSignal.timeout(10000)});if(!r.ok)throw Error('Pin widget unavailable');return r.json();};
 try{
  const {pinterestImages}=await import('../server/photo-api.mjs');const info=await read('pins/info/?pin_ids='+ids.join(',')),pins=(Array.isArray(info.data)?info.data:[]).filter(pin=>ids.includes(String(pin.id)));const result=pinterestImages(pins),boards=new Set();
  for(const pin of pins){const board=pin.board;if(!board?.url)continue;const name=normalize((board.name||'')+' '+board.url);const parts=String(item.title||'').split(/[:\-–—]/).map(s=>s.trim()).filter(Boolean),sub=parts.length>1?normalize(parts.slice(1).join(' ')):'';if(!name.includes(normalize(item.title))&&!(item.zh&&name.includes(normalize(item.zh)))&&!(sub.length>=8&&name.includes(sub)))continue;let url;try{url=new URL(board.url,'https://www.pinterest.com');}catch{continue;}if(!/(^|\.)pinterest\.com$/.test(url.hostname))continue;const path=url.pathname.match(/^\/([\w-]+)\/([^/]+)\/?$/);if(path)boards.add('boards/'+encodeURIComponent(path[1])+'/'+encodeURIComponent(decodeURIComponent(path[2]))+'/pins/');}
  for(const path of [...boards].slice(0,1))try{const data=await read(path);result.push(...pinterestImages(data.data?.pins||[]).filter(image=>matchesPhotoSubject(image.pageUrl,image.title,'pinterest',item)));}catch{/* Keep verified Pin results if the optional board cannot be read. */}
  return result.filter(image=>! /\.gif(?:$|\?)/i.test(image.url)).map(image=>({...image,retrievedVia:'public-pin-widget'}));
 }catch{return[];}
}
