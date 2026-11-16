import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPhotoSource} from '../scripts/photo-source.mjs';
import {imdbPrimaryPhotos,indexedPhotos,enrichPinterest} from '../scripts/photo-index.mjs';

const item={id:'tt21357150',title:'Avengers: Doomsday',kind:'film',year:2026};
const blocked=async()=>({status:'blocked',message:'来源限制了当前请求',images:[]});
const empty=async()=>[];
const pin=(id,file='poster',size='736x')=>({url:`https://i.pinimg.com/${size}/aa/bb/${file}.jpg`,pageUrl:`https://www.pinterest.com/pin/${id}/`,title:'Avengers Doomsday (2026)'});
const record=x=>'m="'+JSON.stringify(x).replaceAll('"','&quot;')+'"';

test('a blocked IMDb gallery can supply only an exactly verified primary image',async()=>{
 let requested;
 const primary=subject=>imdbPrimaryPhotos(subject,{fetcher:async url=>{requested=url;return Response.json({d:[{id:'tt9999999',i:{imageUrl:'https://m.media-amazon.com/images/M/wrong.jpg'}},{id:item.id,l:item.title,i:{imageUrl:'https://m.media-amazon.com/images/M/poster._V1_.jpg'}}]});}});
 const result=await collectPhotoSource({...item,note:'private note'},'imdb',null,{retrieve:blocked,browse:empty,indexed:empty,primary});
 assert.equal(requested,'https://v3.sg.media-imdb.com/suggestion/t/tt21357150.json');
 assert.equal(result.images.length,1);assert.equal(result.images[0].source,'IMDb 公开主图');assert.equal(result.images[0].kind,'作品海报');
 assert.equal(result.status,'ok');assert.equal(result.limited,true);assert.equal(result.upstreamStatus,'blocked');assert.match(result.message,/相册暂不可读/);assert.equal(result.nextCursor,null);
});

test('the metadata fallback rejects mismatched identifiers and non-IMDb image hosts',async()=>{
 for(const d of [[{id:'tt9999999',i:{imageUrl:'https://m.media-amazon.com/images/M/wrong.jpg'}}],[{id:item.id,i:{imageUrl:'https://unrelated.example/poster.jpg'}}]]){
  assert.deepEqual(await imdbPrimaryPhotos(item,{fetcher:async()=>Response.json({d})}),[]);
 }
 const person={id:'nm3641002',kind:'person',title:'Austin Abrams'};
 const images=await imdbPrimaryPhotos(person,{fetcher:async url=>{assert.match(url,/suggestion\/n\/nm3641002\.json$/);return Response.json({d:[{id:person.id,l:person.title,i:{imageUrl:'https://m.media-amazon.com/images/M/actor.jpg'}}]});}});
 assert.equal(images[0].kind,'人物肖像');assert.match(images[0].pageUrl,/\/name\/nm3641002\//);
});

test('an empty index tries another query without admitting unrelated sites or remakes',async()=>{
 const queries=[];
 const images=await indexedPhotos('pinterest',item,{first:71,fetcher:async url=>{
  queries.push(new URL(url));if(queries.length===1)return new Response(record({murl:'https://unrelated.example/image.jpg',purl:'https://www.pinterest.com/pin/1/',t:item.title}));
  return new Response(record({murl:pin('2').url,purl:pin('2').pageUrl,t:'Avengers Doomsday (2026)'})+record({murl:pin('3','wrong').url,purl:pin('3').pageUrl,t:'Avengers Doomsday (1985)'}));
 }});
 assert.equal(images.length,1);assert.equal(images[0].pageUrl,pin('2').pageUrl);assert.equal(queries.length,2);
 assert.match(queries[0].searchParams.get('q'),/"Avengers Doomsday"/);assert.equal(queries[1].searchParams.get('first'),'1');
});

test('a blocked archive with no images retries page one and keeps old photos if every path fails',async()=>{
 let first;
 const result=await collectPhotoSource(item,'imdb',{indexOffset:71,images:[]},{retrieve:blocked,browse:empty,indexed:async(_,__,options)=>{first=options.first;return [];},primary:empty});
 assert.equal(first,1);assert.equal(result.indexOffset,1);assert.equal(result.status,'blocked');assert.deepEqual(result.images,[]);
 const prior={indexOffset:36,images:[pin('2')],updatedAt:'2026-11-15T00:00:00Z'};
 const kept=await collectPhotoSource(item,'pinterest',prior,{retrieve:blocked,browse:empty,indexed:empty,enrich:empty});
 assert.deepEqual(kept.images,prior.images);assert.equal(kept.updatedAt,prior.updatedAt);assert.equal(kept.indexOffset,36);assert.equal(kept.status,'blocked');
});

test('official Pin images survive optional board failures and unrelated returned Pins are excluded',async()=>{
 const paths=[];
 const data={id:'123',description:'Avengers Doomsday',images:{'564x':{url:pin('123','poster','564x').url}},board:{name:'Avengers Doomsday',url:'/owner/avengers-doomsday/'}};
 const images=await enrichPinterest([pin('123')],item,{fetcher:async url=>{
  paths.push(new URL(url).pathname);if(paths.length===1)return Response.json({data:[data,{...data,id:'999',images:{'564x':{url:pin('999','wrong').url}}}]});
  return new Response('Unavailable',{status:503});
 }});
 assert.equal(paths.length,2);assert.equal(images.length,1);assert.match(images[0].pageUrl,/\/123\//);assert.equal(images[0].retrievedVia,'public-pin-widget');
});

test('a Pin found through an index unlocks its public board and deduplicates image resolutions',async()=>{
 const indexed=async()=>[pin('123')];
 const enrich=(images,subject)=>enrichPinterest(images,subject,{fetcher:async url=>Response.json(url.includes('pins/info')?
  {data:[{id:'123',description:'Avengers Doomsday',images:{'564x':{url:pin('123','poster','564x').url}},board:{name:'Avengers Doomsday',url:'/owner/avengers-doomsday/'}}]}:
  {data:{pins:[{id:'124',description:'Avengers Doomsday (2026)',images:{'564x':{url:pin('124','second','564x').url}}},{id:'125',description:'Avengers Doomsday (1985)',images:{'564x':{url:pin('125','wrong').url}}}]}})});
 const result=await collectPhotoSource(item,'pinterest',null,{retrieve:blocked,browse:empty,indexed,enrich});
 assert.equal(result.status,'ok');assert.equal(result.method,'public-pin-widget');assert.equal(result.images.length,2);assert.equal(result.indexOffset,36);assert.ok(result.images.every(image=>!image.url.includes('wrong')));
});
