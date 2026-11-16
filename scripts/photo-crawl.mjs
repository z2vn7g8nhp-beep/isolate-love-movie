import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {retrievePhotoPages,parseImdbHtml,parseDoubanHtml,parsePinterestHtml,decodeCursor} from '../server/photo-api.mjs';
import {detail} from '../public/data-client.js';
import {indexedPhotos,enrichPinterest,matchesPhotoSubject} from './photo-index.mjs';
import {cachePhotoPreviews} from './photo-cache.mjs';
const root=new URL('../photo-data/',import.meta.url),subjects=JSON.parse(await readFile(new URL('subjects.json',root),'utf8'));
const max=Math.max(1,Math.min(40,Number(process.env.PHOTO_SUBJECT_LIMIT)||3));
const requested=(process.env.PHOTO_SUBJECT_IDS||'').split(',').filter(Boolean);
if(requested.some(id=>!/^(tt|nm)\d{5,12}$/.test(id)||!subjects.some(item=>item.id===id)))throw Error('待采集的公开条目尚未登记');
const browserTried=new Set();let browser;
const getJson=async(url,fallback)=>{try{return JSON.parse(await readFile(url,'utf8'));}catch{return fallback;}};
const unique=items=>[...new Map(items.filter(x=>x?.url).map(x=>[x.url,x])).values()];
async function browserPhotos(source,item){
 if(browserTried.has(source))return[];browserTried.add(source);
 try{
  const {chromium}=await import('playwright');browser||=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({locale:'en-US',viewport:{width:1440,height:1000}});await page.route('**/*',route=>['image','font','media'].includes(route.request().resourceType())?route.abort():route.continue());
  const urls={imdb:'https://www.imdb.com/'+(item.kind==='person'?'name':'title')+'/'+item.id+'/mediaindex/',douban:item.douban?'https://movie.douban.com/'+(item.kind==='person'?'celebrity':'subject')+'/'+item.douban+'/photos/?type='+(item.kind==='person'?'C':'S'):'',pinterest:'https://www.pinterest.com/search/pins/?q='+encodeURIComponent(item.title+' '+(item.year||'')+' '+(item.kind==='person'?'portrait':'stills'))};
  if(!urls[source]){await page.close();return[];}
  try{await page.goto(urls[source],{waitUntil:'domcontentloaded',timeout:22000});await page.waitForTimeout(1800);const html=await page.content(),visible=await page.locator('body').innerText().catch(()=>'');if(/verify you are human|access denied|异常请求|访问异常|请输入验证码/i.test(visible.slice(0,20000)))return[];
   const parsed=source==='imdb'?parseImdbHtml(html,item):source==='douban'?parseDoubanHtml(html,item):parsePinterestHtml(html);
   if(parsed.length)return parsed;
   if(source!=='douban'){const rows=await page.evaluate(source=>[...document.querySelectorAll(source==='imdb'?'a[href*="/mediaviewer/"] img':'a[href*="/pin/"] img')].map(img=>({url:img.currentSrc||img.src,pageUrl:img.closest('a').href,title:img.alt})),source);return rows.filter(x=>source==='imdb'?/^https:\/\/m\.media-amazon\.com\//.test(x.url):/^https:\/\/i\.pinimg\.com\//.test(x.url)).map(x=>({...x,thumbnail:x.url,kind:'作品图片',source:source==='imdb'?'IMDb 相册':'Pinterest 搜索',license:'版权归原权利人'}));}
   return[];
  }finally{await page.close();}
 }catch(error){console.log(JSON.stringify({stage:'browser',source,status:'unavailable',message:error.message.slice(0,160)}));return[];}
}
async function crawl(item,source,old){
 const direct=await retrievePhotoPages({...item,source,cursor:old?.nextCursor?decodeCursor(old.nextCursor):null},{pages:Number(process.env.PHOTO_SOURCE_PAGES)||1});let images=direct.images||[],method='direct',status=direct.status,message=direct.message;
 if(!images.length){images=await browserPhotos(source,item);method='browser';}
 if(!images.length)try{images=await indexedPhotos(source,item,{first:old?.indexOffset||1});method='public-image-index';}catch(error){message+='; '+error.message;}
 if(source==='pinterest'&&images.length){const pins=await enrichPinterest(images,item);if(pins.length){images=unique([...pins,...images]);method='public-pin-widget';}}
 if(images.length){status='ok';message=method==='public-image-index'?'三站公开图片经搜索索引发现':'从原站读取';}
 let combined=unique([...(old?.images||[]).filter(image=>matchesPhotoSubject(image.pageUrl,image.title,source,item)),...images]).slice(-120);
 if(source==='douban'&&item.cachePhotos){combined=unique([...(old?.images||[]).filter(image=>image.cachedUrl),...combined]).slice(0,48);combined=await cachePhotoPreviews(combined,item);}
 console.log(JSON.stringify({subject:item.id,source,status,method,newImages:images.length,total:combined.length}));
 return {nextCursor:direct.images?.length?direct.nextCursor:null,indexOffset:(old?.indexOffset||1)>=106?1:(old?.indexOffset||1)+35,name:{imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'}[source],status,message,method,...(source==='douban'&&item.cachePhotos?{previewLimit:48}:{}),images:combined,updatedAt:images.length?new Date().toISOString():old?.updatedAt||null,checkedAt:new Date().toISOString()};
}
await mkdir(new URL('subjects/',root),{recursive:true});const manifest=await getJson(new URL('index.json',root),{version:1,subjects:{}});
const ordered=subjects.filter(item=>!requested.length||requested.includes(item.id)).sort((a,b)=>Date.parse(manifest.subjects[a.id]?.checkedAt||'1970-01-01')-Date.parse(manifest.subjects[b.id]?.checkedAt||'1970-01-01'));
const external=await getJson(new URL('external-ids.json',root),{});
try{for(const raw of ordered.slice(0,max)){let item={...raw};if(!item.douban){try{const metadata=external[item.id]||await detail(item.id,item.title,{signal:AbortSignal.timeout(15000)});if(metadata.item?.douban){external[item.id]=metadata;item={...item,douban:metadata.item.douban};}}catch{}}const path=new URL('subjects/'+item.id+'.json',root),old=await getJson(path,{sources:{}}),sources={};for(const source of ['imdb','douban','pinterest'])sources[source]=await crawl(item,source,old.sources[source]);const record={version:1,item:{id:item.id,title:item.title,zh:item.zh||'',kind:item.kind,year:item.year||null},sources,checkedAt:new Date().toISOString()};await writeFile(path,JSON.stringify(record,null,2)+'\n');manifest.subjects[item.id]={title:item.title,path:'subjects/'+item.id+'.json',checkedAt:record.checkedAt,counts:Object.fromEntries(Object.entries(sources).map(([key,value])=>[key,value.images.length]))};}}
finally{await browser?.close();}
await writeFile(new URL('external-ids.json',root),JSON.stringify(external,null,2)+'\n');
manifest.updatedAt=new Date().toISOString();await writeFile(new URL('index.json',root),JSON.stringify(manifest,null,2)+'\n');
