import {cleanAlbum,photoKey} from './collection.js';
export const PHOTO_DATA_BASE=new URL('./photo-data/',import.meta.url).href;
export const DIRECT_SOURCES={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
const snapshots=new Map(),pending=new Map();
export const PHOTO_REQUEST_MARKER='<!-- isolate-photo-request:v1 -->';
export function photoSubjectId(item){return item.kind==='character'?(item.workId||item.actorId||''):item.id||'';}
export function photoRequestUrl(item){
 const id=photoSubjectId(item);if(!/^(tt|nm)\d{5,12}$/.test(id))return '';
 const name=item.kind==='character'?'':String(item.title||'').replace(/[\r\n]/g,' ').slice(0,140);
 const url=new URL('https://github.com/z2vn7g8nhp-beep/isolate-love-movie/issues/new');
 url.search=new URLSearchParams({title:'[图库] '+(name?name+' · ':'')+id,body:PHOTO_REQUEST_MARKER+'\nIMDb: '+id+'\n\n请为这个公开影视或人物条目建立或更新图库。仅提交此公开编号，不包含我的收藏、评分或笔记。'});return url.href;
}
async function readIndex(url,signal,refresh=false){
 if(refresh)snapshots.delete(url);
 const old=snapshots.get(url);if(old&&old.until>Date.now())return old.value;
 if(pending.has(url))return pending.get(url);
 const job=(async()=>{let response;try{response=await fetch(url,{signal:signal||AbortSignal.timeout(15000),credentials:'omit',cache:'no-cache'});}catch(error){if(error.name==='AbortError')throw error;throw Error(error.name==='TimeoutError'?'图库连接超时，请重新读取':'未能连接图库，请检查网络后重试');}if(response.status===404){snapshots.set(url,{value:null,until:Date.now()+5000});return null;}if(!response.ok)throw Error('图库返回 HTTP '+response.status+'，请稍后重新读取');let value;try{value=await response.json();}catch{throw Error('图库文件未正确发布，请稍后重新读取');}snapshots.set(url,{value,until:Date.now()+60000});return value;})();
 pending.set(url,job);try{return await job;}finally{pending.delete(url);}
}
export async function fetchPhotoSource(item,{source,cursor,signal,knownImages,baseUrl=PHOTO_DATA_BASE,refresh=false}={}){
 if(!DIRECT_SOURCES[source])throw Error('未知图片来源');
 const id=photoSubjectId(item);
 if(!/^(tt|nm)\d+$/.test(id||''))return {source,status:'unmatched',images:[],nextCursor:null,message:'暂未关联公开影视标识'};
 const url=new URL('subjects/'+id+'.json',baseUrl).href,data=await readIndex(url,signal,refresh);
 if(!data)return {source,status:'unmatched',registered:false,images:[],nextCursor:null,message:'该条目的图库尚未建立，可提交补图请求'};
 if(data.item?.id!==id)throw Error('图库档案标识不匹配');
 const record=data.sources?.[source];if(!record)return {source,status:'unmatched',registered:true,images:[],nextCursor:null,message:'这个来源暂未建立图库'};
 const images=cleanAlbum(record.images),known=new Set((knownImages||[]).map(image=>photoKey(image.url)));
 const offset=knownImages?0:Number(String(cursor||'').match(/^data:(\d+)$/)?.[1]||0),unseen=knownImages?images.filter(image=>!known.has(photoKey(image.url))):images;
 const page=unseen.slice(offset,offset+12),next=offset+12<unseen.length?'data:'+(offset+12):null;
 const complete=record.previewLimit&&images.length>=record.previewLimit;
 return {source,registered:true,status:page.length?'ok':images.length?(complete?'complete':'empty'):record.status||'unavailable',images:page,nextCursor:next,method:record.method||'direct',updatedAt:record.updatedAt||null,checkedAt:record.checkedAt||data.checkedAt,datasetAt:data.checkedAt||null,message:page.length?'读取已抓取的公开图库':complete?'已读完 '+images.length+' 张预览，更多可查看原站':images.length?'本批图片已读完，后台更新后可继续':record.message||'来源暂不可用'};
}
