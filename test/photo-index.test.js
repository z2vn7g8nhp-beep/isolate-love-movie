import test from 'node:test';import assert from 'node:assert/strict';import {parseImageIndex} from '../scripts/photo-index.mjs';
const record=x=>'m="'+JSON.stringify(x).replaceAll('"','&quot;')+'"';
test('indexed photos retain the actual site and CDN, excluding unrelated result sources',()=>{const item={id:'tt1',title:'A Film',zh:'一部电影'};const html=record({murl:'https://m.media-amazon.com/images/M/p._V1_.jpg',purl:'https://www.imdb.com/title/tt1/mediaviewer/rm2/',t:'A Film'})+record({murl:'https://m.media-amazon.com/images/M/other.jpg',purl:'https://example.org/film',t:'A Film'});const images=parseImageIndex(html,'imdb',item);assert.equal(images.length,1);assert.equal(images[0].source,'IMDb · 搜索索引');assert.equal(images[0].retrievedVia,'public-image-index');assert.match(images[0].pageUrl,/imdb\.com/);});
test('index results with unrelated titles or a mismatched site image are discarded',()=>{const item={id:'nm1',title:'Actor One'};const html=record({murl:'https://i.pinimg.com/originals/a/b/c.jpg',purl:'https://www.pinterest.com/pin/123/',t:'Someone else'})+record({murl:'https://img1.doubanio.com/view/photo/m/public/p1.jpg',purl:'https://www.pinterest.com/pin/124/',t:'Actor One'});assert.deepEqual(parseImageIndex(html,'pinterest',item),[]);});

test('same-title remakes cannot inherit an IMDb gallery belonging to another title',()=>{const row=record({murl:'https://m.media-amazon.com/images/M/a.jpg',purl:'https://www.imdb.com/title/tt0090270/mediaviewer/rm1/',t:'VisionQuest'});assert.deepEqual(parseImageIndex(row,'imdb',{id:'tt23112594',title:'VisionQuest',year:2026}),[]);const pin=record({murl:'https://i.pinimg.com/564x/a/b/c.jpg',purl:'https://www.pinterest.com/pin/123/',t:'VisionQuest (1985)'});assert.deepEqual(parseImageIndex(pin,'pinterest',{id:'tt23112594',title:'VisionQuest',year:2026}),[]);});
test('multi-year IMDb exact matches, regional Pinterest pins and long colon subtitles are preserved',()=>{
 const got=record({murl:'https://m.media-amazon.com/images/M/s8._V1_.jpg',purl:'https://www.imdb.com/title/tt0944947/mediaviewer/rm9/',t:'Game of Thrones Season 8 (2019)'});
 assert.equal(parseImageIndex(got,'imdb',{id:'tt0944947',title:'Game of Thrones',year:2011}).length,1);
 const hg={id:'tt32578226',title:'The Hunger Games: Sunrise on the Reaping',year:2026};
 const pinDe=record({murl:'https://i.pinimg.com/736x/11/22/hg.jpg',purl:'https://de.pinterest.com/pin/sunrise-on-the-reaping-poster--555/',t:'Sunrise on the Reaping (2026)'});
 const pinOld=record({murl:'https://i.pinimg.com/736x/11/22/old.jpg',purl:'https://www.pinterest.com/pin/666/',t:'The Hunger Games (2012)'});
 const res=parseImageIndex(pinDe+pinOld,'pinterest',hg);
 assert.equal(res.length,1);assert.equal(res[0].pageUrl,'https://www.pinterest.com/pin/555/');
});

test('indexed photos fall back to DuckDuckGo image index when Bing yields zero matches',async()=>{
 const {indexedPhotos}=await import('../scripts/photo-index.mjs');
 const hg={id:'tt10545296',title:'The Hunger Games: The Ballad of Songbirds & Snakes',kind:'film',year:2023};
 const fetcher=async url=>{
  if(url.includes('bing.com'))return new Response('<html><body>no matches</body></html>');
  if(url.includes('duckduckgo.com/?'))return new Response('<script>vqd="4-123456-789";</script>');
  if(url.includes('duckduckgo.com/i.js'))return Response.json({results:[
   {url:'https://uk.pinterest.com/pin/the-ballad-of-songbirds-and-snakes--987654/',image:'https://i.pinimg.com/originals/aa/bb/ok.jpg',title:'The Ballad of Songbirds and Snakes (2023)'},
   {url:'https://www.pinterest.com/pin/111111/',image:'https://i.pinimg.com/736x/aa/bb/old.jpg',title:'The Hunger Games (2012)'},
   {url:'https://example.org/other',image:'https://i.pinimg.com/736x/aa/bb/bad.jpg',title:'The Ballad of Songbirds and Snakes'}
  ]});
  return new Response('',{status:404});
 };
 const images=await indexedPhotos('pinterest',hg,{fetcher});
 assert.equal(images.length,1);assert.equal(images[0].pageUrl,'https://www.pinterest.com/pin/987654/');assert.match(images[0].thumbnail,/\/236x\//);
});
