import test from 'node:test';
import assert from 'node:assert/strict';
import {photoProgressMarkup,photoPublicationReady,photoTaskStalled,photoTaskWithSnapshot} from '../public/photo-progress.js';
import {photoTaskDelay} from '../public/photo-outbox.js';
import {summarizePhotoCrawl,reportPhotoProgress} from '../scripts/photo-queue-report.mjs';
const now=Date.parse('2026-11-16T12:30:00Z'),requestedAt='2026-11-16T12:10:00Z';

test('delayed queue shows actual elapsed time, position and no invented finish time or percentage',()=>{
 const html=photoProgressMarkup({status:'queued',requestedAt,queueAhead:2,lastCollectorAt:'2026-11-16T12:00:00Z',statusCheckedAt:now},now);
 assert.match(html,/等待启动已延迟/);assert.match(html,/已等待 20 分钟/);assert.match(html,/前面还有 2 个条目/);assert.match(html,/无法预计启动时间/);assert.match(html,/采集器上次检查/);assert.equal((html.match(/aria-current="step"/g)||[]).length,1);assert.doesNotMatch(html,/%|通常需要几分钟|role="progressbar"/);
 const first=photoProgressMarkup({status:'queued',requestedAt:new Date(now-30000).toISOString(),queueAhead:0},now);assert.match(first,/不足 1 分钟/);assert.match(first,/队列首位/);assert.doesNotMatch(first,/启动已延迟/);
});
test('per-source outcomes and publication are separate, and lost polling shows the last confirmed state',()=>{
 const html=photoProgressMarkup({status:'processing',stage:'collecting',requestedAt,updatedAt:now,sources:{imdb:{status:'fetching'},douban:{status:'blocked',newImages:0,total:0}},lastCheckError:'Load failed',statusCheckedAt:now-60000},now);
 assert.match(html,/正在读取图片/);assert.match(html,/限制访问/);assert.match(html,/新增 0 张/);assert.match(html,/等待读取/);assert.match(html,/进度连接暂时中断/);assert.doesNotMatch(html,/Load failed/);
 assert.match(photoProgressMarkup({status:'processing',stage:'publishing',requestedAt,updatedAt:now},now),/图片已采集，正在发布/);
 const stalled={status:'processing',stage:'collecting',updatedAt:now-16*60000};assert.equal(photoTaskStalled(stalled,now),true);assert.match(photoProgressMarkup(stalled,now),/data-request-photos/);
});
test('a completed zero-image collection is explicit rather than an endless loading state',()=>{
 const html=photoProgressMarkup({status:'loaded',requestedAt,summary:{added:0,total:3},sources:{imdb:{status:'blocked',newImages:0,total:1},douban:{status:'unmatched',newImages:0,total:0},pinterest:{status:'ok',newImages:0,total:2}}},now);
 assert.match(html,/本次没有新增图片/);assert.match(html,/图库现有 3 张去重图片/);assert.match(html,/未找到图库/);assert.doesNotMatch(html,/正在读取|等待启动|每 20 秒检查/);
});
test('a published snapshot repairs missing outcomes without inventing per-request additions',()=>{
 const task={status:'loaded',requestedAt},snapshot={registered:true,datasetAt:new Date(now).toISOString(),datasetTotal:73,datasetSources:{imdb:{status:'ok',total:1,limited:true},douban:{status:'ok',total:36},pinterest:{status:'ok',total:36}}};
 const repaired=photoTaskWithSnapshot(task,snapshot),html=photoProgressMarkup(repaired,now);
 assert.equal(repaired.summary.total,73);assert.equal(repaired.summary.added,undefined);assert.match(html,/仅公开主图/);assert.match(html,/图库共 36 张/);assert.doesNotMatch(html,/未提供结果|本次新增|新增 0/);
 assert.equal(photoTaskWithSnapshot(task,{...snapshot,datasetAt:'2026-11-15T00:00:00Z'}),task);
 const reported={...task,summary:{added:2,total:73},sources:{pinterest:{status:'ok',newImages:2,total:36}}};
 assert.deepEqual(photoTaskWithSnapshot(reported,snapshot).sources.pinterest,reported.sources.pinterest);assert.equal(photoTaskWithSnapshot(reported,snapshot).summary.added,2);
});
test('publication waits for the expected dataset, retries stale data and accepts a later published revision',()=>{
 const task={status:'syncing',requestedAt,dataCheckedAt:'2026-11-16T12:25:00Z'};
 assert.equal(photoPublicationReady(task,{registered:false}),false);assert.equal(photoPublicationReady(task,{registered:true,datasetAt:requestedAt}),false);
 assert.equal(photoPublicationReady(task,{registered:true,datasetAt:task.dataCheckedAt}),true);assert.equal(photoPublicationReady(task,{registered:true,datasetAt:'2026-11-16T12:26:00Z'}),true);
 assert.equal(photoPublicationReady({requestedAt},{registered:true,checkedAt:requestedAt}),true);assert.equal(photoTaskDelay({tt1234567:task},now),20000);
 assert.match(photoProgressMarkup(task,now),/图库已发布，正在读取/);
});
test('completion totals deduplicate existing photos and resolution variants across providers',()=>{
 const pin=n=>({url:'https://i.pinimg.com/'+n+'/aa/bb/existing.jpg'}),imdb={url:'https://m.media-amazon.com/images/M/new._V1_.jpg'};
 assert.deepEqual(summarizePhotoCrawl({pinterest:{images:[pin('236x')]}},{pinterest:{images:[pin('originals'),pin('736x')]},imdb:{images:[imdb,imdb]}}),{total:2,added:1});
 assert.deepEqual(summarizePhotoCrawl({pinterest:{images:[pin('236x')]}},{pinterest:{images:[pin('originals')]}}),{total:1,added:0});
});
test('collector progress calls serialize a heartbeat before its finished source result',async()=>{
 const oldFetch=globalThis.fetch,keys=['PHOTO_QUEUE_PROGRESS','PHOTO_QUEUE_KEY','PHOTO_QUEUE_URL','GITHUB_RUN_ID'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{PHOTO_QUEUE_PROGRESS:'1',PHOTO_QUEUE_KEY:'server-test',PHOTO_QUEUE_URL:'https://queue.example/',GITHUB_RUN_ID:'12345'});
 const sent=[];let release;const block=new Promise(resolve=>release=resolve);
 globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));if(sent.length===1)await block;return new Response('{"ok":true}');};
 try{const first=reportPhotoProgress('nm10514458',{stage:'collecting',source:'imdb',sourceStatus:'fetching'}),last=reportPhotoProgress('nm10514458',{stage:'collecting',source:'imdb',sourceStatus:'ok',total:2,newImages:1});await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);release();await Promise.all([first,last]);assert.equal(sent[1].items[0].sourceStatus,'ok');assert.equal(sent[1].items[0].runId,'12345');}
 finally{globalThis.fetch=oldFetch;for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
