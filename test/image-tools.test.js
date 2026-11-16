import test from 'node:test';
import assert from 'node:assert/strict';
import {thumbnailUrl,mergePhotos,parsePinterest,imagesFromLink} from '../public/image-tools.js';
import {cleanAlbum,validImageUrl} from '../public/collection.js';
import {fetchGallery} from '../public/data-client.js';
import {seriesPhotoPage} from '../public/visual-data.js';

test('thumbnail rendering retains original images and uses lightweight source sizes',()=>{
 const image={url:'https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg',thumbnail:'https://static.tvmaze.com/uploads/images/medium_landscape/1/2.jpg'};
 assert.equal(thumbnailUrl(image),image.thumbnail);
 assert.equal(thumbnailUrl(image.url,300,'portrait'),'https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg');
 assert.match(thumbnailUrl('https://commons.wikimedia.org/wiki/Special:FilePath/Photo.jpg?width=1100',360),/width=360/);
 assert.match(thumbnailUrl('https://m.media-amazon.com/images/M/photo._V1_.jpg',300),/UX300/);
 assert.equal(image.url,'https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg');
});

test('static previews survive imports and merges while preserving the original source image',()=>{
 const cachedUrl='https://z2vn7g8nhp-beep.github.io/isolate-love-movie/photo-data/images/nm3641002/'+ 'a'.repeat(24)+'.webp';
 const original={url:'https://img9.doubanio.com/view/photo/l/public/p2412557885.jpg',title:'我的照片'};
 const fresh={...original,cachedUrl,thumbnail:cachedUrl};const merged=mergePhotos([original],[fresh]);assert.equal(merged.length,1);assert.equal(merged[0].url,original.url);assert.equal(merged[0].cachedUrl,cachedUrl);assert.equal(thumbnailUrl(merged[0]),cachedUrl);
 assert.equal(validImageUrl(cachedUrl),cachedUrl);assert.equal(validImageUrl(cachedUrl.replace('github.io','github.io.evil.example')),'');assert.equal(validImageUrl(cachedUrl.replace('a'.repeat(24),'../private')),'');
 assert.equal(cleanAlbum([original,{url:original.url.replace('/l/','/m/').replace('img9','img3')}]).length,1);
});

test('photo pagination deduplicates resolution variants and preserves the saved order',()=>{
 const old={url:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Photo.jpg/1100px-Photo.jpg',title:'我的图片',kind:'照片'};
 const fresh={url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg',thumbnail:'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Photo.jpg/480px-Photo.jpg'};
 const other={url:'https://i.pinimg.com/564x/aa/bb/cc/photo.jpg'};
 const merged=mergePhotos([old],[fresh,other]);assert.equal(merged.length,2);assert.equal(merged[0].title,'我的图片');assert.equal(merged[0].url,old.url);assert.equal(merged[0].thumbnail,fresh.thumbnail);
 assert.equal(cleanAlbum([{url:other.url},{url:other.url.replace('/564x/','/236x/')}]).length,1);
});

test('manual source imports validate hostnames and keep source attribution',async()=>{
 assert.equal(validImageUrl('https://img9.doubanio.com/view/photo/l/public/a.jpg').startsWith('https:'),true);
 assert.equal(validImageUrl('https://i.pinimg.com.evil.example/a.jpg'),'');
 const direct=await imagesFromLink('https://img9.doubanio.com/view/photo/l/public/a.jpg');assert.match(direct[0].source,/豆瓣/);
 const pin=parsePinterest({data:[{id:'123',description:'Role image',images:{'236x':{url:'https://i.pinimg.com/236x/a/b/c.jpg'},'564x':{url:'https://i.pinimg.com/564x/a/b/c.jpg'}}},{id:'bad',images:{}}]});
 assert.equal(pin.length,1);assert.equal(pin[0].pageUrl,'https://www.pinterest.com/pin/123/');assert.equal(pin[0].author,'');assert.ok(pin[0].thumbnail.includes('/236x/'));
 await assert.rejects(imagesFromLink('https://example.com/pin/123/'),/图片地址/);
 await assert.rejects(imagesFromLink('http://www.pinterest.com/pin/123/'),/https/);
});

test('Pinterest imports use the selected public Pin or board and reject missing pictures',async()=>{
 const original=globalThis.fetch,urls=[];globalThis.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>({data:[{id:'123',images:{'564x':{url:'https://i.pinimg.com/564x/a/b/c.jpg'}}}]})};};
 try{assert.equal((await imagesFromLink('https://www.pinterest.com/pin/123/')).length,1);assert.match(urls[0],/pin_ids=123/);await imagesFromLink('https://www.pinterest.com/user/selected-board/');assert.match(urls[1],/boards\/user\/selected-board\/pins/);globalThis.fetch=async()=>({ok:true,json:async()=>({data:[{id:'123',error:'Not found'}]})});await assert.rejects(imagesFromLink('https://www.pinterest.com/pin/123/'),/没有读到/);}finally{globalThis.fetch=original;}
});

test('Commons fetch resumes at the returned offset without replacing earlier pages',async()=>{
 const original=globalThis.fetch,urls=[];globalThis.fetch=async url=>{urls.push(new URL(url));return {ok:true,json:async()=>({continue:{gsroffset:48},query:{pages:{one:{title:'File:New.jpg',imageinfo:[{mime:'image/jpeg',url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/New.jpg',thumburl:'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/New.jpg/480px-New.jpg'}]}}}})};};
 try{const data=await fetchGallery({id:'nm1',kind:'person',wikidata:'Q1'},{},{offset:36});assert.equal(urls[0].searchParams.get('gsroffset'),'36');assert.equal(urls[0].searchParams.get('gsrlimit'),'12');assert.equal(data.nextOffset,48);assert.equal(data.images.length,1);assert.ok(data.images[0].thumbnail.includes('480px'));}finally{globalThis.fetch=original;}
});

test('series image pagination advances episodes and seasons using a verified show cursor',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>({ok:true,json:async()=>Array.from({length:String(url).includes('/11/')?14:2},(_,i)=>({name:'Episode '+i,season:String(url).includes('/11/')?1:2,number:i+1,url:'https://www.tvmaze.com/episodes/'+i,image:{original:'https://static.tvmaze.com/original/'+i+'.jpg',medium:'https://static.tvmaze.com/thumb/'+i+'.jpg'}}))});
 try{const item={id:'tt1',kind:'series'},cursor={showId:1,seasonIds:[11,12],seasonIndex:0,offset:12};const first=await seriesPhotoPage(item,cursor);assert.equal(first.images.length,2);assert.equal(first.cursor.seasonIndex,1);assert.equal(first.cursor.offset,0);assert.ok(first.images[0].thumbnail.includes('/thumb/'));const second=await seriesPhotoPage(item,first.cursor);assert.equal(second.images.length,2);assert.equal(second.cursor,null);}finally{globalThis.fetch=original;}
});

test('derived image indexes have entry and size budgets without evicting the current archive',async()=>{
 const {boundedCache}=await import('../public/image-tools.js');const source={a:{fetchedAt:'2026-01-01',text:'a'.repeat(60)},b:{fetchedAt:'2026-02-01',text:'b'.repeat(60)},c:{fetchedAt:'2026-03-01',text:'c'.repeat(60)}};
 assert.deepEqual(Object.keys(boundedCache(source,2,1000,'a')),['a','c']);const limited=boundedCache(source,3,150,'a');assert.deepEqual(Object.keys(limited),['a']);assert.equal(Object.keys(source).length,3);
});
