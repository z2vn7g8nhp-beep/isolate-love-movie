import {cleanAlbum} from './collection.js';
export const PHOTO_ENDPOINT=typeof location!=='undefined'&&['localhost','127.0.0.1'].includes(location.hostname)?'/isolate/v1/photos':'https://movie-radar-production.up.railway.app/isolate/v1/photos';
export const DIRECT_SOURCES={imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'};
export async function fetchPhotoSource(item,{source,cursor,signal,endpoint=PHOTO_ENDPOINT}={}){
 if(!DIRECT_SOURCES[source])throw Error('未知图片来源');
 const id=item.kind==='character'?(item.workId||item.actorId||''):item.id;
 const params=new URLSearchParams({source,id:/^(tt|nm)\d+$/.test(id||'')?id:'',kind:item.kind,title:item.title,zh:item.zh||'',work:item.work||'',year:item.year?String(item.year):'',douban:item.douban?String(item.douban):''});
 if(cursor)params.set('after',cursor);
 const response=await fetch(endpoint+'?'+params,{signal:signal||AbortSignal.timeout(18000),credentials:'omit',cache:'no-store'});
 if(!response.ok)throw Error(response.status===429?'图片请求较多，请稍后继续':'抓图后台暂不可用');
 const data=await response.json();if(data.source!==source||!['ok','empty','blocked','unavailable','unmatched','busy'].includes(data.status))throw Error('图片来源响应异常');
 return {...data,images:cleanAlbum(data.images),nextCursor:typeof data.nextCursor==='string'?data.nextCursor:null};
}
