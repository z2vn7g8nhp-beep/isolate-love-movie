import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePhotoRequest,verifyPhotoSubject,registerPhotoSubject} from '../scripts/photo-request.mjs';
import {photoRequestUrl} from '../public/photo-client.js';

test('the browser request round-trips as a validated public identifier',()=>{
 const body=new URL(photoRequestUrl({id:'nm3641002',title:'Austin Abrams',kind:'person'})).searchParams.get('body');
 assert.equal(parsePhotoRequest(body),'nm3641002');assert.equal(parsePhotoRequest(body.replaceAll('\n','\r\n')),'nm3641002');
 assert.throws(()=>parsePhotoRequest('IMDb: nm3641002'),/不是/);
 assert.throws(()=>parsePhotoRequest('<!-- isolate-photo-request:v1 -->\nIMDb: $(touch /tmp/file)'),/有效/);
});
test('registry uses canonical IMDb metadata and rejects nonmatching suggestions',async()=>{
 const id='nm3641002';let address;
 const subject=await verifyPhotoSubject(id,{fetcher:async url=>{address=url;return {ok:true,json:async()=>({d:[{id,l:'Austin Abrams',s:'Actor'}]})};}});
 assert.equal(address,'https://v3.sg.media-imdb.com/suggestion/n/nm3641002.json');assert.deepEqual(subject,{id,title:'Austin Abrams',kind:'person'});
 await assert.rejects(verifyPhotoSubject(id,{fetcher:async()=>({ok:true,json:async()=>({d:[{id:'nm1234567',l:'Other person'}]})})}),/一致/);
 await assert.rejects(verifyPhotoSubject('https://private.example/'),/无效/);
});
test('TV metadata and repeated requests preserve one registry entry and verified Douban association',async()=>{
 const item=await verifyPhotoSubject('tt23112594',{fetcher:async()=>({ok:true,json:async()=>({d:[{id:'tt23112594',l:'VisionQuest',qid:'tvSeries',y:2026}]})})});
 assert.equal(item.kind,'series');assert.equal(item.year,2026);
 const old=[{...item,douban:'36137784',zh:'幻视任务'}],same=registerPhotoSubject(old,item);assert.equal(same.length,1);assert.equal(same[0].douban,'36137784');assert.equal(same[0].zh,'幻视任务');
 const added=registerPhotoSubject(same,{id:'nm3641002',title:'Austin Abrams',kind:'person'});assert.equal(added.length,2);assert.equal(old.length,1);
});
