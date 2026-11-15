const sources={imdb:{page:/(^|\.)imdb\.com$/,image:/^m\.media-amazon\.com$/},douban:{page:/(^|\.)douban\.com$/,image:/^img\d*\.doubanio\.com$/},pinterest:{page:/(^|\.)pinterest\.(com|co\.uk)$/,image:/^i\.pinimg\.com$/}};
const names={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
const decode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;|&#x27;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function parseImageIndex(html,source,item){
 const rule=sources[source];if(!rule)return[];const result=[],seen=new Set();
 for(const match of html.matchAll(/\bm=("[^"]*"|'[^']*')/g))try{
  const row=JSON.parse(decode(match[1].slice(1,-1))),image=new URL(row.murl),page=new URL(row.purl);
  if(!['https:','http:'].includes(image.protocol)||page.protocol!=='https:'||!rule.image.test(image.hostname)||!rule.page.test(page.hostname))continue;
  image.protocol='https:';const caption=decode(row.t||row.desc||''),n=normalize(caption),title=normalize(item.title),zh=normalize(item.zh);
  const exactId=source==='imdb'&&page.pathname.includes('/'+item.id+'/');
  if(!exactId&&!(title&&n.includes(title))&&!(zh&&n.includes(zh)))continue;
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
 const query='"'+title+'" '+(item.year||'')+' site:'+scope;
 const url='https://www.bing.com/images/search?'+new URLSearchParams({q:query,first:String(first),count:'35',adlt:'strict'});
 const response=await fetch(url,{signal:signal||AbortSignal.timeout(18000),headers:{'user-agent':'Mozilla/5.0','accept-language':'en-US,en;q=0.8,zh-CN;q=0.6'}});
 if(!response.ok)throw Error('公开图片索引返回 '+response.status);
 return parseImageIndex(await response.text(),source,item);
}
