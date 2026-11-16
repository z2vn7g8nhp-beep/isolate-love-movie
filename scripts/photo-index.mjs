const sources={imdb:{page:/(^|\.)imdb\.com$/,image:/^m\.media-amazon\.com$/},douban:{page:/(^|\.)douban\.com$/,image:/^img\d*\.doubanio\.com$/},pinterest:{page:/(^|\.)pinterest\.(com|co\.uk)$/,image:/^i\.pinimg\.com$/}};
const names={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
const decode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function matchesPhotoSubject(pageUrl,caption,source,item){
 try{const page=new URL(pageUrl),id=page.pathname.match(/\/(?:title|name)\/((?:tt|nm)\d+)/)?.[1];if(source==='imdb'&&id&&id!==item.id)return false;
 const release=String(caption||'').match(/\(((?:19|20)\d{2})\)/)?.[1];if(item.year&&release&&Number(release)!==Number(item.year)&&!String(item.title).includes(release))return false;
 return true;
 }catch{return false;}
}
export function parseImageIndex(html,source,item){
 const rule=sources[source];if(!rule)return[];const result=[],seen=new Set();
 for(const match of html.matchAll(/\bm=("[^"]*"|'[^']*')/g))try{
  const row=JSON.parse(decode(match[1].slice(1,-1))),image=new URL(row.murl),page=new URL(row.purl);
  if(!['https:','http:'].includes(image.protocol)||page.protocol!=='https:'||!rule.image.test(image.hostname)||!rule.page.test(page.hostname))continue;
  image.protocol='https:';const caption=decode(row.t||row.desc||'');if(!matchesPhotoSubject(page.href,caption,source,item))continue;const n=normalize(caption+' '+(row.desc||'')),title=normalize(item.title),zh=normalize(item.zh);
  const exactId=source==='imdb'&&page.pathname.includes('/'+item.id+'/');
  const words=String(item.title||'').toLowerCase().match(/[a-z]{3,}/g)||[];const closePin=source==='pinterest'&&words.length>=2&&words.every(word=>n.includes(word));if(!exactId&&!closePin&&!(title&&n.includes(title))&&!(zh&&n.includes(zh)))continue;
  if(/\.gif(?:$|\?)/i.test(image.href)||seen.has(image.href))continue;seen.add(image.href);
  let thumbnail=image.href;
  if(source==='imdb')thumbnail=image.href.replace(/\._V1_.*(?=\.(?:jpg|png))/i,'._V1_QL80_UX360_');
  if(source==='douban')thumbnail=image.href.replace(/\/view\/photo\/(l|raw|xl)\/public\//,'/view/photo/m/public/');
  if(source==='pinterest'){thumbnail=image.href.replace(/\/(originals|736x|564x)\//,'/236x/');const pin=page.pathname.match(/\/pin\/(?:[^/]*--)?(\d+)\/?/);if(!pin)continue;page.href='https://www.pinterest.com/pin/'+pin[1]+'/';}
  result.push({url:image.href,thumbnail,title:caption.slice(0,200)||item.title,kind:'搜索图片',source:names[source]+' · 搜索索引',license:'版权归原权利人',pageUrl:page.href,retrievedVia:'public-image-index'});
 }catch{}
 return result;
}
export async function indexedPhotos(source,item,{first=1,signal}={}){
 const scope={imdb:'imdb.com',douban:'movie.douban.com',pinterest:'pinterest.com/pin'}[source];
 const title=source==='douban'?(item.zh||item.title):item.title;
 const query='site:'+scope+(source==='imdb'&&item.kind!=='person'?'/title/'+item.id:'')+' '+title;
 const url='https://www.bing.com/images/search?'+new URLSearchParams({q:query,first:String(first),count:'35',adlt:'strict'});
 const response=await fetch(url,{signal:signal||AbortSignal.timeout(18000),headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.8,zh-CN;q=0.6'}});
 if(!response.ok)throw Error('公开图片索引返回 '+response.status);
 const html=await response.text(),images=parseImageIndex(html,source,item);console.log(JSON.stringify({stage:'index',source,subject:item.id,bytes:html.length,records:(html.match(/murl/g)||[]).length,matched:images.length}));return images;
}

// Public Pin widgets may expose a complete board dedicated to the same subject.
export async function enrichPinterest(images,item,{signal}={}){
 const ids=[...new Set(images.map(image=>image.pageUrl?.match(/\/pin\/(\d+)/)?.[1]).filter(Boolean))].slice(0,12);if(!ids.length)return[];
 const read=async path=>{const r=await fetch('https://widgets.pinterest.com/v3/pidgets/'+path,{signal:signal||AbortSignal.timeout(15000)});if(!r.ok)throw Error('Pin widget unavailable');return r.json();};
 try{
  const {pinterestImages}=await import('../server/photo-api.mjs');const info=await read('pins/info/?pin_ids='+ids.join(',')),pins=Array.isArray(info.data)?info.data:[];const result=pinterestImages(pins),boards=new Set();
  for(const pin of pins){const board=pin.board;if(!board?.url)continue;const name=normalize((board.name||'')+' '+board.url);if(!name.includes(normalize(item.title))&&!(item.zh&&name.includes(normalize(item.zh))))continue;let url;try{url=new URL(board.url,'https://www.pinterest.com');}catch{continue;}if(!/(^|\.)pinterest\.com$/.test(url.hostname))continue;const path=url.pathname.match(/^\/([\w-]+)\/([^/]+)\/?$/);if(path)boards.add('boards/'+encodeURIComponent(path[1])+'/'+encodeURIComponent(decodeURIComponent(path[2]))+'/pins/');}
  for(const path of [...boards].slice(0,1)){const data=await read(path);result.push(...pinterestImages(data.data?.pins||[]));}
  return result.filter(image=>! /\.gif(?:$|\?)/i.test(image.url));
 }catch{return[];}
}
