import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuery,encodeCursor,decodeCursor,imdbImages,parseImdbHtml,parseDoubanHtml,pinterestImages,parsePinterestHtml,handlePhotoRequest} from '../server/photo-api.mjs';
const subject={source:'imdb',id:'tt123',kind:'film',title:'A Film'};

test('source requests accept only supported sources and exact identifiers',()=>{
 const item=validateQuery(new URLSearchParams({source:'imdb',id:'tt123',kind:'film',title:'A Film',note:'must not be forwarded'}));assert.equal(item.id,'tt123');assert.equal(item.note,undefined);
 assert.throws(()=>validateQuery(new URLSearchParams({source:'https://localhost',title:'Film'})),/未知/);
 assert.throws(()=>validateQuery(new URLSearchParams({source:'imdb',id:'https://169.254.169.254',title:'Film'})),/标识/);
 const after=encodeCursor({source:'pinterest',bookmark:'next'});assert.deepEqual(decodeCursor(after),{source:'pinterest',bookmark:'next'});
 assert.throws(()=>validateQuery(new URLSearchParams({source:'imdb',id:'tt1',title:'Film',after})),/不匹配/);
});

test('IMDb gallery extraction uses only the matching title image connection',()=>{
 const connection={edges:[{node:{id:'rm123',url:'https://m.media-amazon.com/images/M/image._V1_.jpg',caption:{plainText:'A still'}}},{node:{url:'https://example.com/unrelated.jpg'}}]};
 const images=imdbImages(connection,subject);assert.equal(images.length,1);assert.equal(images[0].source,'IMDb 相册');assert.match(images[0].thumbnail,/UX360/);assert.match(images[0].pageUrl,/rm123/);
 const html='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{aboveTheFoldData:{id:'tt123'},mainColumnData:{images:connection}}}})+'</script>';
 assert.equal(parseImdbHtml(html,subject).length,1);assert.throws(()=>parseImdbHtml(html,{...subject,id:'tt999'}),/未匹配/);
});

test('Douban gallery extraction excludes unrelated poster and avatar images',()=>{
 const html='<a href="https://movie.douban.com/photos/photo/123/"><img src="https://img1.doubanio.com/view/photo/m/public/p123.jpg"></a><img src="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p9.jpg"><a href="https://example.com/photos/photo/5/"><img src="https://img1.doubanio.com/view/photo/m/public/p5.jpg"></a>';
 const images=parseDoubanHtml(html,subject);assert.equal(images.length,1);assert.match(images[0].url,/\/l\/public/);assert.match(images[0].thumbnail,/\/m\/public/);assert.equal(images[0].source,'豆瓣 相册');
});

test('Pinterest extracts public search pins and labels them as search candidates',()=>{
 const pins=[{id:'123',description:'Film still',images:{'236x':{url:'https://i.pinimg.com/236x/aa/bb/photo.jpg'},'736x':{url:'https://i.pinimg.com/736x/aa/bb/photo.jpg'}}},{id:'124',is_video:true,images:{}}];
 assert.equal(pinterestImages(pins).length,1);assert.equal(pinterestImages(pins)[0].source,'Pinterest 搜索');
 const html='<script id="__PWS_DATA__" type="application/json">'+JSON.stringify({resourceResponses:[{response:{data:{results:pins}}}]})+'</script>';
 assert.equal(parsePinterestHtml(html).length,1);
});

test('backend serves CORS only to the app and never treats a blocked source as success',async()=>{
 const forbidden=await handlePhotoRequest(new Request('https://reader.example/health',{headers:{origin:'https://other.example'}}));assert.equal(forbidden.status,403);
 const health=await handlePhotoRequest(new Request('https://reader.example/health',{headers:{origin:'https://z2vn7g8nhp-beep.github.io'}}));assert.equal(health.status,200);assert.equal(health.headers.get('access-control-allow-origin'),'https://z2vn7g8nhp-beep.github.io');
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('Forbidden',{status:403});
 try{const result=await(await handlePhotoRequest(new Request('https://reader.example/v1/photos?source=imdb&id=tt9991&title=Blocked'))).json();assert.equal(result.status,'blocked');assert.deepEqual(result.images,[]);}finally{globalThis.fetch=original;}
});

test('server-side Pinterest requests continue the actual bookmark',async()=>{
 const original=globalThis.fetch;let query;globalThis.fetch=async url=>{query=new URL(url);return new Response(JSON.stringify({resource_response:{data:{results:[{id:'567',images:{'564x':{url:'https://i.pinimg.com/564x/aa/bb/p.jpg'}}}]}},resource:{options:{bookmarks:['next-page']}}}),{headers:{'content-type':'application/json'}});};
 try{const url=new URL('https://reader.example/v1/photos');url.search=new URLSearchParams({source:'pinterest',title:'A film',id:'tt987',after:encodeCursor({source:'pinterest',bookmark:'previous-page'})});const data=await(await handlePhotoRequest(new Request(url))).json();assert.equal(data.images.length,1);assert.equal(data.status,'ok');assert.equal(decodeCursor(data.nextCursor).bookmark,'next-page');assert.equal(JSON.parse(query.searchParams.get('data')).options.bookmarks[0],'previous-page');}finally{globalThis.fetch=original;}
});
