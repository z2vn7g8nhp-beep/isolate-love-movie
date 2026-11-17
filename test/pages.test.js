import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {imdbQuery,fromImdb,wikiFields,imdbSearch,pagesApi} from '../public/data-client.js';
test('IMDb query normalization prevents executable callback names',()=>{assert.equal(imdbQuery('Amélie / 2001'),'amelie_2001');assert.equal(imdbQuery('Ryan Gosling'),'ryan_gosling');assert.equal(imdbQuery('tt1856101'),'tt1856101');assert.equal(imdbQuery('x);alert(1)//'),'x_alert_1');assert.throws(()=>imdbQuery('花样年华'));});
test('legacy and modern IMDb metadata preserve IDs and images',()=>{const a=fromImdb({id:'tt123',l:'Film',q:'TV series',i:['https://m.media-amazon.com/test.jpg',500,700]});assert.equal(a.kind,'series');assert.equal(a.image,'https://m.media-amazon.com/test.jpg');const b=fromImdb({id:'nm123',l:'Actor',i:{imageUrl:'photo'}});assert.equal(b.kind,'person');assert.equal(b.image,'photo');});
test('IMDb JSONP resolves, deduplicates and removes injected script',async()=>{const scope={},scripts=[];const doc={createElement:()=>({remove(){this.removed=true;}}),head:{append(script){scripts.push(script);}}};const a=imdbSearch('Test One',{document:doc,scope}),b=imdbSearch('Test One',{document:doc,scope});assert.equal(scripts.length,1);assert.equal(scripts[0].src,'https://sg.media-imdb.com/suggests/t/test_one.json');scope.imdb$test_one({d:[{id:'tt1234',l:'Test'},{id:'bad',l:'Ignore'}]});assert.equal((await a)[0].id,'tt1234');assert.deepEqual(await a,await b);assert.equal(scripts[0].removed,true);assert.equal(scope.imdb$test_one,undefined);});
test('IMDb script error is recoverable and cleans up',async()=>{const scope={},scripts=[];const doc={createElement:()=>({remove(){this.removed=true;}}),head:{append(script){scripts.push(script);}}};const a=imdbSearch('Test Failure',{document:doc,scope});scripts[0].onerror();await assert.rejects(a,/暂不可用/);assert.equal(scripts[0].removed,true);assert.equal(scope.imdb$test_failure,undefined);});
test('Wikidata extracts exact external IDs without invented ratings',()=>{const e={id:'Q123',labels:{zh:{value:'中文'}},claims:{P4529:[{mainsnak:{datavalue:{value:'10512661'}}}]}};assert.deepEqual(wikiFields(e),{wikidata:'Q123',zh:'中文',douban:'10512661'});const tw={id:'Q124',labels:{'zh-tw':{value:'繁體片名'}},claims:{}};assert.deepEqual(wikiFields(tw),{wikidata:'Q124',zh:'繁體片名'});});
test('Wikidata detail resolves exact IMDb P345 matches even when title search would miss them',async()=>{const {detail}=await import('../public/data-client.js');const old=globalThis.fetch;globalThis.fetch=async url=>{const u=new URL(url);if(u.searchParams.get('list')==='search')return {ok:true,json:async()=>({query:{search:[{title:'Q777'}]}})};if(u.searchParams.get('action')==='wbgetentities')return {ok:true,json:async()=>({entities:{Q777:{id:'Q777',labels:{'zh-tw':{value:'飢餓遊戲：黎明收割'}},claims:{P345:[{mainsnak:{datavalue:{value:'tt32578226'}}}],P4529:[{mainsnak:{datavalue:{value:'36900001'}}}]}}}})};throw Error('unexpected query '+url);};try{const res=await detail('tt32578226','The Hunger Games: Sunrise on the Reaping');assert.equal(res.item.wikidata,'Q777');assert.equal(res.item.zh,'飢餓遊戲：黎明收割');assert.equal(res.item.douban,'36900001');}finally{globalThis.fetch=old;}});
test('GitHub Pages does not request an unavailable server or cloud library',async()=>{const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('unexpected fetch');};try{assert.deepEqual(await pagesApi('library'),{available:false,records:{}});await assert.rejects(pagesApi('unknown'),/静态版/);}finally{globalThis.fetch=original;}});
test('static entrypoints use relative assets for the repository subpath',async()=>{const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.ok(html.includes('href="./manifest.webmanifest"'));assert.ok(html.includes('src="./app.js"'));assert.ok(!html.includes('src="/'));const script=await readFile(new URL('../public/app.js',import.meta.url),'utf8');assert.ok(script.includes("from './data-client.js'"));assert.ok(!script.includes("fetch('./api/"));});
test('search falls back to Cinemeta and IMDb-linked Wikidata entries when IMDb JSONP fails',async()=>{
 const {search}=await import('../public/data-client.js');
 const oldFetch=globalThis.fetch,oldDoc=globalThis.document;
 globalThis.document={createElement:()=>{const s={remove(){}};queueMicrotask(()=>s.onerror?.());return s;},head:{append(){}}};
 globalThis.fetch=async url=>{
  const u=new URL(url);
  if(u.hostname==='v3-cinemeta.strem.io'&&u.pathname.includes('/movie/top/search='))return {ok:true,json:async()=>({metas:[{id:'tt1392170',imdb_id:'tt1392170',type:'movie',name:'The Hunger Games',releaseInfo:'2012',poster:'https://images.metahub.space/poster/small/tt1392170/img',genres:['Sci-Fi']}]})};
  if(u.hostname==='v3-cinemeta.strem.io'&&u.pathname.includes('/series/top/search='))return {ok:true,json:async()=>({metas:[]})};
  if(u.hostname==='v3-cinemeta.strem.io'&&u.pathname.includes('/meta/movie/tt0986233.json'))return {ok:true,json:async()=>({meta:{imdb_id:'tt0986233',type:'movie',name:'Hunger',releaseInfo:'2008'}})};
  if(u.hostname==='v3-cinemeta.strem.io'&&u.pathname.includes('/meta/series/tt0986233.json'))return {ok:false,status:404};
  if(u.hostname==='www.wikidata.org'&&u.searchParams.get('action')==='wbsearchentities')return {ok:true,json:async()=>({search:[{id:'Q165947'}]})};
  if(u.hostname==='www.wikidata.org'&&u.searchParams.get('list')==='search'&&u.searchParams.get('srsearch').includes('P345=tt0986233'))return {ok:true,json:async()=>({query:{search:[{title:'Q1637811'}]}})};
  if(u.hostname==='www.wikidata.org'&&u.searchParams.get('list')==='search')return {ok:true,json:async()=>({query:{search:[{title:'Q212965'},{title:'Q1637811'},{title:'Q124457667'}]}})};
  if(u.hostname==='www.wikidata.org'&&u.searchParams.get('action')==='wbgetentities'){
   return {ok:true,json:async()=>({entities:{
    Q165947:{id:'Q165947',labels:{en:{value:'hunger'},'zh-cn':{value:'饥饿'}},claims:{}},
    Q212965:{id:'Q212965',labels:{mul:{value:'The Hunger Games'},'zh-cn':{value:'饥饿游戏'}},claims:{P345:[{mainsnak:{datavalue:{value:'tt1392170'}}}],P577:[{mainsnak:{datavalue:{value:{time:'+2012-03-23T00:00:00Z'}}}}]}},
    Q1637811:{id:'Q1637811',labels:{en:{value:'Hunger'},'zh-cn':{value:'大绝食'}},claims:{P345:[{mainsnak:{datavalue:{value:'tt0986233'}}}],P577:[{mainsnak:{datavalue:{value:{time:'+2008-01-01T00:00:00Z'}}}}]}},
    Q124457667:{id:'Q124457667',labels:{en:{value:'Spike Fearn'},'zh-tw':{value:'史派克·費恩'}},claims:{P345:[{mainsnak:{datavalue:{value:'nm10514458'}}}],P31:[{mainsnak:{datavalue:{value:{id:'Q5'}}}}]}}
   }})};
  }
  throw Error('unexpected url '+url);
 };
 try{
  const res=await search('Hunger','all');
  assert.match(res.warning,/IMDb 暂不可用/);
  assert.equal(res.items[0].id,'tt0986233');
  assert.equal(res.items[0].zh,'大绝食');
  assert.equal(res.items[1].id,'tt1392170');
  assert.equal(res.items[1].zh,'饥饿游戏');
  assert.match(res.items[1].image,/\/poster\/medium\/tt1392170\/img/);
  const people=await search('Spike Fearn','person');
  assert.deepEqual(people.items.map(x=>x.id),['nm10514458']);
  const byUrl=await search('https://www.imdb.com/title/tt0986233/','all');
  assert.equal(byUrl.items[0].id,'tt0986233');
  assert.equal(byUrl.items[0].zh,'大绝食');
 }finally{
  globalThis.fetch=oldFetch;globalThis.document=oldDoc;
 }
});
