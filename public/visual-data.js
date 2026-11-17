import {imdbSearch,plainMetadata} from './data-client.js';
const Wiki='https://www.wikidata.org/w/api.php';
const claim=(entity,property)=>entity?.claims?.[property]?.find(x=>x.rank!=='deprecated')?.mainsnak?.datavalue?.value;
const values=(entity,property)=>(entity?.claims?.[property]||[]).filter(x=>x.rank!=='deprecated').map(x=>x.mainsnak?.datavalue?.value).filter(Boolean);
const label=entity=>entity?.labels?.['zh-cn']?.value||entity?.labels?.zh?.value||entity?.labels?.en?.value||entity?.labels?.mul?.value||'';
async function json(url,signal){const r=await fetch(url,{signal:signal||AbortSignal.timeout(18000),credentials:'omit'});if(!r.ok)throw Error('来源暂不可用');return r.json();}
async function wiki(params,signal){return json(Wiki+'?'+new URLSearchParams({...params,format:'json',origin:'*'}),signal);}
function imageFromWiki(entity){const file=claim(entity,'P18');return typeof file==='string'?'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(file)+'?width=500':'';}
export function workFromEntity(entity,personId){const imdb=claim(entity,'P345');const date=values(entity,'P577').find(x=>/^\+\d{4}/.test(x.time||''))?.time;const id=/^tt\d+$/.test(imdb||'')?imdb:entity.id;const title=entity.labels?.en?.value||entity.labels?.mul?.value||label(entity);const roles=[];if(values(entity,'P161').some(x=>x.id===personId))roles.push('参演');if(values(entity,'P57').some(x=>x.id===personId))roles.push('导演');return {id,title,zh:entity.labels?.['zh-cn']?.value||entity.labels?.zh?.value||'',wikidata:entity.id,kind:values(entity,'P31').some(x=>['Q5398426','Q1259759'].includes(x.id))?'series':'film',year:date?Number(date.slice(1,5)):null,image:/^tt/.test(id)?'https://images.metahub.space/poster/medium/'+id+'/img':imageFromWiki(entity),role:roles.join(' / '),source:'Wikidata 参演 / 导演记录',reference:'https://www.wikidata.org/wiki/'+entity.id};}
export async function filmography(wikidata,{signal}={}){
  if(!/^Q\d+$/.test(wikidata||''))return [];
  const params={action:'query',list:'search',srsearch:'haswbstatement:P161='+wikidata+'|P57='+wikidata,srnamespace:'0',srlimit:'50'};
  const found=await wiki(params,signal),pages=[found];
  if(found.continue?.sroffset)pages.push(await wiki({...params,sroffset:String(found.continue.sroffset)},signal));
  const ids=[...new Set(pages.flatMap(x=>(x.query?.search||[]).map(x=>x.title)))].filter(x=>/^Q\d+$/.test(x));
  const batches=[];for(let i=0;i<ids.length;i+=30)batches.push(ids.slice(i,i+30));
  const results=await Promise.allSettled(batches.map(ids=>wiki({action:'wbgetentities',ids:ids.join('|'),props:'labels|claims',languages:'zh-cn|zh|en|mul'},signal)));
  if(signal?.aborted)throw signal.reason;
  const works=[];
  for(const result of results)if(result.status==='fulfilled')for(const entity of Object.values(result.value.entities||{})){
    const direct=values(entity,'P161').some(x=>x.id===wikidata)||values(entity,'P57').some(x=>x.id===wikidata);
    if(direct)works.push(workFromEntity(entity,wikidata));
  }
  return works.sort((a,b)=>(b.year||0)-(a.year||0));
}
async function summary(data,signal){for(const [lang,title]of[['zh',data.wikiArticleZh],['en',data.wikiArticle]]){if(!title)continue;try{const info=await json('https://'+lang+'.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title),signal);if(info.type==='disambiguation'||!info.extract)continue;return {text:info.extract.slice(0,1500),lang,source:lang==='zh'?'中文维基百科':'英文维基百科',url:info.content_urls?.desktop?.page||'https://'+lang+'.wikipedia.org/wiki/'+encodeURIComponent(title)};}catch(e){if(signal?.aborted)throw e;}}return null;}
export function parseCinemeta(meta,id){if(!meta||(meta.imdb_id||meta.id)!==id)throw Error('作品标识未匹配');const seen=new Set(),trailers=[...(meta.trailerStreams||[]).map(x=>({id:x.ytId,title:x.title})),...(meta.trailers||[]).map(x=>({id:x.source,title:'预告影像'}))].filter(x=>/^[\w-]{11}$/.test(x.id||'')&&!seen.has(x.id)&&seen.add(x.id)).slice(0,5).map(x=>({url:'https://i.ytimg.com/vi/'+x.id+'/hqdefault.jpg',title:x.title||'预告影像',kind:'预告封面',source:'YouTube 预告 · Cinemeta 作品关联',license:'版权归原权利人',pageUrl:'https://www.youtube.com/watch?v='+x.id}));return {summary:meta.description?{text:String(meta.description).slice(0,1500),lang:'en',source:'Cinemeta · IMDb 标识关联',url:'https://www.imdb.com/title/'+id+'/'}:null,genres:meta.genres||meta.genre||[],runtime:meta.runtime||'',background:meta.background||'',trailers,castNames:meta.cast||[],released:meta.released||'',source:'Cinemeta'};}
export function parseMazeCast(data){return (Array.isArray(data)?data:[]).slice(0,30).map(({person,character})=>({title:person.name,zh:'',kind:'person',role:'演员',character:character?.name||'',image:person.image?.medium||person.image?.original||'',characterImage:character?.image?.medium||character?.image?.original||'',characterOriginal:character?.image?.original||'',actorOriginal:person.image?.original||'',source:'TVmaze',reference:person.url}));}
export function linkKnownCast(cast,credits){
 const key=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase();
 return cast.map(person=>{const matches=credits.filter(credit=>credit.role==='演员'&&/^nm\d+$/.test(credit.id||'')&&key(credit.title)===key(person.title));return matches.length===1?{...matches[0],...person,id:matches[0].id,wikidata:matches[0].wikidata,zh:matches[0].zh||''}:person;});
}
async function seriesExtras(item,signal){const show=await json('https://api.tvmaze.com/lookup/shows?imdb='+item.id,signal);if(show.externals?.imdb!==item.id)throw Error('剧集标识未匹配');const results=await Promise.allSettled([json('https://api.tvmaze.com/shows/'+show.id+'/cast',signal),json('https://api.tvmaze.com/shows/'+show.id+'/images',signal),json('https://api.tvmaze.com/shows/'+show.id+'/seasons',signal)]);const cast=results[0].status==='fulfilled'?parseMazeCast(results[0].value):[],images=[];let photoCursor=null;if(results[1].status==='fulfilled')for(const image of results[1].value.slice(0,15)){const url=image.resolutions?.original?.url||image.resolutions?.medium?.url;if(url)images.push({url,thumbnail:image.resolutions?.medium?.url||url,title:show.name+' · '+({poster:'海报',background:'背景图',banner:'横幅'}[image.type]||'作品图片'),kind:image.type==='poster'?'海报':'背景图',source:'TVmaze · IMDb 剧集标识关联',license:'版权归原权利人',pageUrl:show.url});}
if(results[2].status==='fulfilled'){const season=results[2].value.find(x=>x.number===1)||results[2].value[0];if(season)try{const episodes=await json('https://api.tvmaze.com/seasons/'+season.id+'/episodes',signal);const pictured=episodes.filter(x=>x.image);photoCursor=pictured.length>16?{showId:show.id,seasonIds:results[2].value.map(x=>x.id),seasonIndex:0,offset:16}:results[2].value.length>1?{showId:show.id,seasonIds:results[2].value.map(x=>x.id),seasonIndex:1,offset:0}:null;for(const episode of pictured.slice(0,16))images.unshift({url:episode.image.original||episode.image.medium,thumbnail:episode.image.medium||episode.image.original,title:'S'+String(episode.season).padStart(2,'0')+'E'+String(episode.number).padStart(2,'0')+' · '+episode.name,kind:'剧照',source:'TVmaze · 对应剧集单集图片',license:'版权归原权利人',pageUrl:episode.url});}catch(e){if(signal?.aborted)throw e;}}
return {cast,images,photoCursor,genres:show.genres||[],runtime:show.runtime?show.runtime+' 分钟':'',summary:show.summary?{text:plainMetadata(show.summary).slice(0,1500),lang:'en',source:'TVmaze 剧集简介',url:show.url}:null,status:show.status||'',network:show.network?.name||show.webChannel?.name||''};}
export async function visualDossier(item,data,{signal}={}){const results=await Promise.allSettled([summary(data,signal),item.kind==='person'?filmography(data.item?.wikidata||item.wikidata,{signal}):json('https://v3-cinemeta.strem.io/meta/'+(item.kind==='series'?'series':'movie')+'/'+item.id+'.json',signal).then(x=>parseCinemeta(x.meta,item.id)),item.kind==='series'?seriesExtras(item,signal):Promise.resolve(null)]);if(signal?.aborted)throw signal.reason;const article=results[0].status==='fulfilled'?results[0].value:null,extra=results[1].status==='fulfilled'?results[1].value:null,tv=results[2].status==='fulfilled'?results[2].value:null;const credits=data.credits||[],cast=tv?.cast?.length?linkKnownCast(tv.cast,credits):credits.filter(x=>x.role==='演员').length?credits.filter(x=>x.role==='演员'):(extra?.castNames||[]).slice(0,24).map(title=>({title,kind:'person',role:'演员',source:'Cinemeta · IMDb 作品标识关联'})),crew=credits.filter(x=>x.role!=='演员'&&x.role!=='代表作品');const works=item.kind==='person'?(Array.isArray(extra)&&extra.length?extra:credits.filter(x=>x.role==='代表作品')):[];
return {version:2,photoCursor:tv?.photoCursor||null,summary:article||tv?.summary||extra?.summary||null,cast,crew,works,genres:tv?.genres?.length?tv.genres:extra?.genres||[],runtime:tv?.runtime||extra?.runtime||'',images:[...(tv?.images||[]),...(extra?.trailers||[])],background:extra?.background||'',status:tv?.status||'',network:tv?.network||'',fetchedAt:new Date().toISOString()};}
export async function fillPortrait(credit,{signal}={}){if(!/^nm\d+$/.test(credit.id||''))return credit;const list=await imdbSearch(credit.id,{signal});const found=list.find(x=>x.id===credit.id);return found?{...credit,image:found.image}:credit;}

export async function seriesPhotoPage(item,cursor,{signal}={}){
 if(item.kind!=='series')return {images:[],cursor:null};
 if(!cursor?.seasonIds){const show=await json('https://api.tvmaze.com/lookup/shows?imdb='+item.id,signal);if(show.externals?.imdb!==item.id)throw Error('剧集标识未匹配');const seasons=await json('https://api.tvmaze.com/shows/'+show.id+'/seasons',signal);cursor={showId:show.id,seasonIds:seasons.map(x=>x.id),seasonIndex:0,offset:cursor?.offset||0};}
 let index=cursor.seasonIndex||0,offset=cursor.offset||0;
 while(index<cursor.seasonIds.length){
  const episodes=(await json('https://api.tvmaze.com/seasons/'+cursor.seasonIds[index]+'/episodes',signal)).filter(x=>x.image);
  const page=episodes.slice(offset,offset+12);
  if(!page.length){index++;offset=0;continue;}
  const images=page.map(episode=>({url:episode.image.original||episode.image.medium,thumbnail:episode.image.medium||episode.image.original,title:'S'+String(episode.season).padStart(2,'0')+'E'+String(episode.number).padStart(2,'0')+' · '+episode.name,kind:'剧照',source:'TVmaze · 对应剧集单集图片',license:'版权归原权利人',pageUrl:episode.url}));
  const nextOffset=offset+page.length,next=nextOffset<episodes.length?{...cursor,seasonIndex:index,offset:nextOffset}:index+1<cursor.seasonIds.length?{...cursor,seasonIndex:index+1,offset:0}:null;
  return {images,cursor:next};
 }
 return {images:[],cursor:null};
}
