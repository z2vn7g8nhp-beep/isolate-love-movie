import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCinemeta,parseMazeCast,filmography} from '../public/visual-data.js';
import {cleanAlbum,normaliseRecords} from '../public/collection.js';
import {describeEntity} from '../public/data-client.js';
const claim=value=>({mainsnak:{datavalue:{value}}});

test('supplementary film metadata rejects a different IMDb title and distinguishes trailer covers',()=>{
 assert.throws(()=>parseCinemeta({imdb_id:'tt2'},'tt1'),/未匹配/);
 const parsed=parseCinemeta({imdb_id:'tt1',description:'Plot',trailers:[{source:'abcdefghijk'},{source:'abcdefghijk'},{source:'bad'}]},'tt1');
 assert.equal(parsed.trailers.length,1);
 assert.equal(parsed.trailers[0].kind,'预告封面');
 assert.match(parsed.trailers[0].pageUrl,/youtube\.com/);
 assert.equal(cleanAlbum(parsed.trailers).length,1);
});

test('TV cast retains actor and role photos without inventing an IMDb identity',()=>{
 const cast=parseMazeCast([{person:{name:'Actor',url:'https://www.tvmaze.com/people/1/actor',image:{medium:'https://static.tvmaze.com/actor.jpg'}},character:{name:'Role',image:{original:'https://static.tvmaze.com/role.jpg'}}}]);
 assert.equal(cast[0].character,'Role');assert.equal(cast[0].image,'https://static.tvmaze.com/actor.jpg');assert.equal(cast[0].characterImage,'https://static.tvmaze.com/role.jpg');assert.equal(cast[0].id,undefined);
});

test('filmography follows pagination, verifies actual credits and ignores deprecated or unrelated matches',async()=>{
 const original=globalThis.fetch,queries=[];
 globalThis.fetch=async input=>{
  const u=new URL(input);queries.push(u);
  let data;
  if(u.searchParams.get('list')==='search')data=u.searchParams.has('sroffset')?{query:{search:[{title:'Q11'},{title:'Q12'}]}}:{query:{search:[{title:'Q10'},{title:'Q99'},{title:'Q13'}]},continue:{sroffset:50}};
  else data={entities:{Q10:{id:'Q10',labels:{en:{value:'Acting'}},claims:{P161:[claim({id:'Q1'})],P345:[claim('tt10')],P577:[claim({time:'+2022-01-01T00:00:00Z'})]}},Q11:{id:'Q11',labels:{en:{value:'Directing'}},claims:{P57:[claim({id:'Q1'})],P345:[claim('tt11')]}},Q12:{id:'Q12',claims:{P161:[{...claim({id:'Q1'}),rank:'deprecated'}]}},Q99:{id:'Q99',claims:{P161:[claim({id:'Q2'})]}},Q13:{id:'Q13',claims:{}}}};
  return {ok:true,json:async()=>data};
 };
 try{const works=await filmography('Q1');assert.equal(works.length,2);assert.equal(works[0].id,'tt10');assert.equal(works[1].role,'导演');assert.equal(queries.filter(x=>x.searchParams.get('list')==='search').length,2);assert.ok(!queries[0].searchParams.get('srsearch').includes(' OR '));}finally{globalThis.fetch=original;}
});

test('Wikidata role names come from the exact actor credit qualifier',()=>{
 const actor=claim({id:'Q2'});actor.qualifiers={P453:[{datavalue:{value:{id:'Q3'}}}]};
 const data=describeEntity({claims:{P161:[actor]}},{Q2:{id:'Q2',labels:{en:{value:'Actor'}},claims:{P345:[claim('nm2')]}},Q3:{id:'Q3',labels:{zh:{value:'角色名'}}}});
 assert.equal(data.credits[0].character,'角色名');
});

test('new image types and sources survive personal archive export and import normalization',()=>{
 const album=[{url:'https://static.tvmaze.com/still.jpg',kind:'剧照',title:'S01E01',source:'TVmaze',pageUrl:'https://www.tvmaze.com/episodes/1'},{url:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',kind:'预告封面',pageUrl:'https://www.youtube.com/watch?v=abcdefghijk'}];
 const records=normaliseRecords({tt1:{item:{id:'tt1',title:'Film',kind:'film'},collected:true,serial:4,note:'原有手记',album,coverImage:album[0].url}});
 assert.equal(records.tt1.album.length,2);assert.equal(records.tt1.album[0].kind,'剧照');assert.equal(records.tt1.album[1].kind,'预告封面');assert.equal(records.tt1.serial,4);assert.equal(records.tt1.note,'原有手记');assert.equal(records.tt1.coverImage,album[0].url);
});

test('TV cast only inherits a verified IMDb identity when one full credited name matches',async()=>{
 const {linkKnownCast}=await import('../public/visual-data.js');
 const cast=[{title:'Actor One',image:'https://static.tvmaze.com/one.jpg',character:'Role'},{title:'Actor Two'}];
 const credits=[{title:'Actor One',id:'nm1',role:'演员',zh:'姓名',wikidata:'Q1'},{title:'Actor Two',id:'nm2',role:'演员'},{title:'Actor Two',id:'nm3',role:'演员'}];
 const result=linkKnownCast(cast,credits);assert.equal(result[0].id,'nm1');assert.equal(result[0].character,'Role');assert.equal(result[0].zh,'姓名');assert.equal(result[0].image,cast[0].image);assert.equal(result[1].id,undefined);
});
