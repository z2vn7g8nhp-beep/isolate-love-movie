import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {assertValidPhotoData,mergePhotoDataSnapshot,parseJsonStrict} from '../scripts/photo-data-sync.mjs';

test('mergePhotoDataSnapshot preserves concurrent subject entries and rejects conflict markers',()=>{
 assert.throws(()=>parseJsonStrict('{"a":1}\n<<<<<<< Updated upstream\n','index.json'),/冲突或无效/);
 const merged=mergePhotoDataSnapshot({
  upstream:{
   subjectsList:[{id:'tt01',title:'Existing'}],
   externalIds:{tt01:{item:{douban:'100'},fetchedAt:'2026-11-16T16:30:00Z'}},
   index:{version:1,subjects:{tt01:{title:'Existing',path:'subjects/tt01.json',checkedAt:'2026-11-16T16:30:00Z',counts:{imdb:10}}}}
  },
  local:{
   subjectsList:[{id:'tt01',title:'Existing'},{id:'tt02',title:'New Queue',cachePhotos:true}],
   externalIds:{tt02:{item:{douban:'200'},fetchedAt:'2026-11-16T16:35:00Z'}},
   index:{version:1,subjects:{tt02:{title:'New Queue'}},updatedAt:'2026-11-16T16:35:00Z'}
  },
  changedSubjects:{
   tt02:{item:{id:'tt02',title:'New Queue'},checkedAt:'2026-11-16T16:35:00Z',sources:{imdb:{images:[{url:'https://m.media-amazon.com/1.jpg'}]},douban:{images:[]},pinterest:{images:[{url:'https://i.pinimg.com/1.jpg'},{url:'https://i.pinimg.com/2.jpg'}]}}}
  }
 });
 assert.equal(merged.subjectsList.length,2);
 assert.deepEqual(Object.keys(merged.externalIds).sort(),['tt01','tt02']);
 assert.equal(merged.index.subjects.tt01.counts.imdb,10);
 assert.deepEqual(merged.index.subjects.tt02.counts,{imdb:1,douban:0,pinterest:2});
});

test('all checked-in photo-data JSON archives parse cleanly without conflict markers',async()=>{
 try{await access(new URL('../photo-data/index.json',import.meta.url));}catch{return;}
 const count=await assertValidPhotoData();
 assert.ok(count>=1);
});
