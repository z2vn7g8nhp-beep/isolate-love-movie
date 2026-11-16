import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {parseImdbHtml,parseDoubanHtml,parsePinterestHtml,parsePinterestPayload,decodeCursor} from '../server/photo-api.mjs';
import {detail} from '../public/data-client.js';
import {collectPhotoSource} from './photo-source.mjs';
import {matchesPhotoSubject} from './photo-index.mjs';
import {cachePhotoPreviews} from './photo-cache.mjs';
import {reportPhotoProgress,summarizePhotoCrawl} from './photo-queue-report.mjs';
const root=new URL('../photo-data/',import.meta.url),subjects=JSON.parse(await readFile(new URL('subjects.json',root),'utf8'));
const max=Math.max(1,Math.min(40,Number(process.env.PHOTO_SUBJECT_LIMIT)||3));
const requested=(process.env.PHOTO_SUBJECT_IDS||'').split(',').filter(Boolean);
if(requested.some(id=>!/^(tt|nm)\d{5,12}$/.test(id)||!subjects.some(item=>item.id===id)))throw Error('待采集的公开条目尚未登记');
const browserTried=new Set(),browserBlocked=new Set();let browser;
const BROWSER_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const getJson=async(url,fallback)=>{try{return JSON.parse(await readFile(url,'utf8'));}catch{return fallback;}};
const unique=items=>[...new Map(items.filter(x=>x?.url).map(x=>[x.url,x])).values()];
async function browserPhotos(source,item){
 const key=source+':'+item.id;if(browserBlocked.has(source)||browserTried.has(key))return[];browserTried.add(key);
 try{
  const {chromium}=await import('playwright');
  if(!browser){try{browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});}catch{browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});}}
  const page=await browser.newPage({locale:'en-US',viewport:{width:1440,height:1000},userAgent:BROWSER_UA});await page.route('**/*',route=>['image','font','media'].includes(route.request().resourceType())?route.abort():route.continue());
  const pinQuery=String(item.title||'').replaceAll('&',' and ').replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
  const urls={imdb:'https://www.imdb.com/'+(item.kind==='person'?'name':'title')+'/'+item.id+'/mediaindex/',douban:item.douban?'https://movie.douban.com/'+(item.kind==='person'?'celebrity':'subject')+'/'+item.douban+'/photos/?type='+(item.kind==='person'?'C':'S'):'',pinterest:'https://www.pinterest.com/search/pins/?q='+encodeURIComponent([pinQuery,item.year||'',item.kind==='person'?'portrait':'stills'].filter(Boolean).join(' '))};
  if(!urls[source]){await page.close();return[];}
  const pinApi=[],pinTasks=[];
  if(source==='pinterest')page.on('response',res=>{if(res.url().includes('/resource/BaseSearchResource/get/')&&res.status()===200)pinTasks.push((async()=>{try{const data=await res.json();if(data?.resource_response?.status!=='failure')pinApi.push(...parsePinterestPayload(data));}catch{}})());});
  try{const waitPinApi=source==='pinterest'?page.waitForResponse(res=>res.url().includes('/resource/BaseSearchResource/get/')&&res.status()===200,{timeout:5500}).catch(()=>null):Promise.resolve();
   const response=await page.goto(urls[source],{waitUntil:'domcontentloaded',timeout:22000});if([401,403,429].includes(response?.status())){browserBlocked.add(source);console.log(JSON.stringify({stage:'browser',source,subject:item.id,status:'blocked',httpStatus:response?.status()}));return[];}await waitPinApi;await page.waitForTimeout(source==='pinterest'?500:1800);await Promise.allSettled(pinTasks);const html=await page.content(),visible=await page.locator('body').innerText().catch(()=>'');if(/verify you are human|access denied|异常请求|访问异常|请输入验证码/i.test(visible.slice(0,20000))){browserBlocked.add(source);console.log(JSON.stringify({stage:'browser',source,subject:item.id,status:'blocked',reason:'challenge'}));return[];}
   const apiMatched=source==='pinterest'?unique(pinApi.filter(image=>matchesPhotoSubject(image.pageUrl,image.title,'pinterest',item))):[];
   if(apiMatched.length){console.log(JSON.stringify({stage:'browser',source,subject:item.id,status:'ok',pins:apiMatched.length}));return apiMatched;}
   const parsed=source==='imdb'?parseImdbHtml(html,item):source==='douban'?parseDoubanHtml(html,item):parsePinterestHtml(html);
   if(parsed.length)return parsed;
   if(source!=='douban'){const rows=await page.evaluate(source=>[...document.querySelectorAll(source==='imdb'?'a[href*="/mediaviewer/"] img':'a[href*="/pin/"] img')].map(img=>({url:img.getAttribute('src')||img.getAttribute('data-src')||img.currentSrc||img.src,pageUrl:img.closest('a')?.href||'',title:img.alt})),source);const matched=rows.filter(x=>source==='imdb'?/^https:\/\/m\.media-amazon\.com\//.test(x.url):/^https:\/\/i\.pinimg\.com\//.test(x.url)).map(x=>({...x,thumbnail:x.url,kind:'作品图片',source:source==='imdb'?'IMDb 相册':'Pinterest 搜索',license:'版权归原权利人'}));if(!matched.length)console.log(JSON.stringify({stage:'browser',source,subject:item.id,status:'empty',httpStatus:response?.status(),title:(await page.title().catch(()=>'')).slice(0,80),bytes:html.length,rows:rows.length,anchors:await page.locator(source==='imdb'?'a[href*="/mediaviewer/"]':'a[href*="/pin/"]').count().catch(()=>0)}));return matched;}
   return[];
  }finally{await page.close();}
 }catch(error){console.log(JSON.stringify({stage:'browser',source,status:'unavailable',message:error.message.slice(0,160)}));return[];}
}
async function crawl(item,source,old){
 const result=await collectPhotoSource(item,source,old,{browse:browserPhotos});let combined=result.images;
 if(source==='douban'&&item.cachePhotos){combined=unique([...(old?.images||[]).filter(image=>image.cachedUrl),...combined]).slice(0,48);combined=await cachePhotoPreviews(combined,item);}
 const summary=summarizePhotoCrawl({[source]:old},{[source]:{images:combined}});console.log(JSON.stringify({subject:item.id,source,status:result.status,method:result.method,newImages:summary.added,total:summary.total}));
 return {...result,...(source==='douban'&&item.cachePhotos?{previewLimit:48}:{}),images:combined};
}
await mkdir(new URL('subjects/',root),{recursive:true});const manifest=await getJson(new URL('index.json',root),{version:1,subjects:{}});
const ordered=subjects.filter(item=>!requested.length||requested.includes(item.id)).sort((a,b)=>Date.parse(manifest.subjects[a.id]?.checkedAt||'1970-01-01')-Date.parse(manifest.subjects[b.id]?.checkedAt||'1970-01-01'));
const external=await getJson(new URL('external-ids.json',root),{});
const results={};
try{for(const raw of ordered.slice(0,max)){
 let item={...raw};await reportPhotoProgress(item.id,{stage:'collecting'});
 const known=external[item.id];
 if(known?.item)item={...item,...(!item.zh&&known.item.zh?{zh:known.item.zh}:{}),...(!item.douban&&known.item.douban?{douban:known.item.douban}:{})};
 if(!item.douban||!item.zh){try{const metadata=known?.item?.douban&&known?.item?.zh?known:await detail(item.id,item.title,{signal:AbortSignal.timeout(15000)});if(metadata?.item&&(metadata.item.douban||metadata.item.zh||metadata.item.wikidata)){external[item.id]=metadata;item={...item,...(!item.zh&&metadata.item.zh?{zh:metadata.item.zh}:{}),...(!item.douban&&metadata.item.douban?{douban:metadata.item.douban}:{})};}}catch{}}
 const path=new URL('subjects/'+item.id+'.json',root),old=await getJson(path,{sources:{}}),sources={};
 if(!item.zh&&old.item?.zh)item={...item,zh:old.item.zh};
 for(const source of ['imdb','douban','pinterest']){
  const progress={stage:'collecting',source,sourceStatus:'fetching'};await reportPhotoProgress(item.id,progress);
  const heartbeat=process.env.PHOTO_QUEUE_PROGRESS==='1'?setInterval(()=>{reportPhotoProgress(item.id,progress);},30000):null;heartbeat?.unref();
  try{sources[source]=await crawl(item,source,old.sources[source]);}finally{clearInterval(heartbeat);}
  const summary=summarizePhotoCrawl({[source]:old.sources[source]},{[source]:sources[source]});
  await reportPhotoProgress(item.id,{stage:'collecting',source,sourceStatus:sources[source].status,total:summary.total,newImages:summary.added});
 }
 if(!item.douban&&sources.douban?.nextCursor){try{const resolved=decodeCursor(sources.douban.nextCursor)?.douban;if(/^\d+$/.test(String(resolved||''))){item={...item,douban:String(resolved)};external[item.id]={...(external[item.id]||{}),item:{...(external[item.id]?.item||{}),...(item.zh?{zh:item.zh}:{}),douban:String(resolved)},fetchedAt:new Date().toISOString()};}}catch{}}
 const record={version:1,item:{id:item.id,title:item.title,zh:item.zh||'',kind:item.kind,year:item.year||null},sources,checkedAt:new Date().toISOString()};
 await writeFile(path,JSON.stringify(record,null,2)+'\n');manifest.subjects[item.id]={title:item.title,path:'subjects/'+item.id+'.json',checkedAt:record.checkedAt,counts:Object.fromEntries(Object.entries(sources).map(([key,value])=>[key,value.images.length]))};
 results[item.id]={summary:summarizePhotoCrawl(old.sources,sources),dataCheckedAt:record.checkedAt};
}}
finally{await browser?.close();}
await writeFile(new URL('external-ids.json',root),JSON.stringify(external,null,2)+'\n');
manifest.updatedAt=new Date().toISOString();await writeFile(new URL('index.json',root),JSON.stringify(manifest,null,2)+'\n');
if(process.env.PHOTO_QUEUE_PROGRESS==='1'){
 await mkdir(new URL('../.data/',root),{recursive:true});await writeFile(new URL('../.data/photo-queue-results.json',root),JSON.stringify(results));
 for(const [id,result]of Object.entries(results))await reportPhotoProgress(id,{stage:'publishing',...result});
}
