import {retrievePhotoPages,decodeCursor} from '../server/photo-api.mjs';
import {photoKey} from '../public/collection.js';
import {indexedPhotos,enrichPinterest,imdbPrimaryPhotos,matchesPhotoSubject} from './photo-index.mjs';

const unique=images=>{const seen=new Set();return images.filter(image=>image?.url&&!seen.has(photoKey(image.url))&&seen.add(photoKey(image.url)));};
export async function collectPhotoSource(item,source,old,{
 retrieve=retrievePhotoPages,browse=async()=>[],indexed=indexedPhotos,enrich=enrichPinterest,primary=imdbPrimaryPhotos,
 pages=Number(process.env.PHOTO_SOURCE_PAGES)||1
}={}){
 const direct=await retrieve({...item,source,cursor:old?.nextCursor?decodeCursor(old.nextCursor):null},{pages});
 let images=direct.images||[],method='direct',status=direct.status,message=direct.message||'',indexedCount=0;
 if(!images.length){images=await browse(source,item);if(images.length)method='browser';}
 // An empty index must be retried from its first page; advancing it skipped
 // newly indexed images indefinitely for previously blocked subjects.
 const first=old?.images?.length?old.indexOffset||1:1;
 if(!images.length)try{images=await indexed(source,item,{first});indexedCount=images.length;if(images.length)method='public-image-index';}catch(error){message+='; '+error.message;}
 if(source==='imdb'&&!images.length)try{images=await primary(item);if(images.length)method='public-metadata';}catch(error){message+='; '+error.message;}
 if(source==='pinterest'){
  const seeds=images.length?images:(old?.images||[]).filter(image=>matchesPhotoSubject(image.pageUrl,image.title,source,item));
  if(seeds.length)try{const pins=await enrich(seeds,item);if(pins.length){images=unique([...pins,...images]);method='public-pin-widget';}}catch(error){message+='; '+error.message;}
 }
 if(images.length){status='ok';message=method==='public-metadata'?'相册暂不可读，已读取 IMDb 公开主图':method==='public-pin-widget'?'从 Pinterest 官方公开组件读取':method==='public-image-index'?'三站公开图片经搜索索引发现':'从原站读取';}
 const combined=unique([...(old?.images||[]).filter(image=>matchesPhotoSubject(image.pageUrl,image.title,source,item)),...images]).slice(-120),now=new Date().toISOString();
 return {nextCursor:direct.images?.length?direct.nextCursor:null,indexOffset:indexedCount?(first>=106?1:first+35):first,name:{imdb:'IMDb',douban:'豆瓣',pinterest:'Pinterest'}[source],status,message,method,...(method==='public-metadata'?{limited:true,upstreamStatus:direct.status}:{}),images:combined,updatedAt:images.length?now:old?.updatedAt||null,checkedAt:now};
}
