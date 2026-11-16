import {cleanAlbum,photoKey} from './collection.js';
export const PHOTO_DATA_BASE=new URL('./photo-data/',import.meta.url).href;
export const DIRECT_SOURCES={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
const snapshots=new Map(),pending=new Map();
async function readIndex(url,signal){
 const old=snapshots.get(url);if(old&&old.until>Date.now())return old.value;
 if(pending.has(url))return pending.get(url);
 const job=(async()=>{const response=await fetch(url,{signal:signal||AbortSignal.timeout(15000),credentials:'omit',cache:'no-cache'});if(response.status===404){snapshots.set(url,{value:null,until:Date.now()+60000});return null;}if(!response.ok)throw Error('公开图库暂时无法读取');const value=await response.json();snapshots.set(url,{value,until:Date.now()+60000});return value;})();
 pending.set(url,job);try{return await job;}finally{pending.delete(url);}
}
export async function fetchPhotoSource(item,{source,cursor,signal,knownImages,baseUrl=PHOTO_DATA_BASE}={}){
 if(!DIRECT_SOURCES[source])throw Error('未知图片来源');
 const id=item.kind==='character'?(item.workId||item.actorId||''):item.id;
 if(!/^(tt|nm)\d+$/.test(id||''))return {source,status:'unmatched',images:[],nextCursor:null,message:'暂未关联公开影视标识'};
 const url=new URL('subjects/'+id+'.json',baseUrl).href,data=await readIndex(url,signal);
 if(!data)return {source,status:'unmatched',images:[],nextCursor:null,message:'该条目的公开图库尚未建立'};
 if(data.item?.id!==id)throw Error('图库档案标识不匹配');
 const record=data.sources?.[source];if(!record)return {source,status:'unmatched',images:[],nextCursor:null,message:'这个来源暂未建立图库'};
 const images=cleanAlbum(record.images),known=new Set((knownImages||[]).map(image=>photoKey(image.url)));
 const offset=knownImages?0:Number(String(cursor||'').match(/^data:(\d+)$/)?.[1]||0),unseen=knownImages?images.filter(image=>!known.has(photoKey(image.url))):images;
 const page=unseen.slice(offset,offset+12),next=offset+12<unseen.length?'data:'+(offset+12):null;
 return {source,status:page.length?'ok':images.length?'empty':record.status||'unavailable',images:page,nextCursor:next,method:record.method||'direct',updatedAt:record.updatedAt||null,checkedAt:record.checkedAt||data.checkedAt,message:page.length?'读取已抓取的公开图库':images.length?'本批图片已读完，后台更新后可继续':record.message||'来源暂不可用'};
}
