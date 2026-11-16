import test from 'node:test';import assert from 'node:assert/strict';
import {restorePhotoTasks,deferPhotoTask,photoTaskDelay} from '../public/photo-outbox.js';
test('home-screen reopen recovers interrupted submissions and older Safari network failures',()=>{
 const tasks=restorePhotoTasks({nm10514458:{status:'failed',message:'Load failed'},tt0816692:{status:'submitting'},nm0079273:{status:'queued'},nm3641002:{status:'failed',message:'今天补图条目较多'},bad:{status:'submitting'}},100);
 assert.equal(tasks.nm10514458.status,'waiting-network');assert.doesNotMatch(tasks.nm10514458.message,/Load failed/);assert.equal(tasks.tt0816692.status,'waiting-network');assert.equal(tasks.nm0079273.status,'queued');assert.equal(tasks.nm3641002.status,'failed');assert.equal(tasks.bad,undefined);assert.equal(photoTaskDelay(tasks,100),1000);
});
test('offline submissions back off, persist across reopen and never claim to be on the server',()=>{
 let task=deferPhotoTask({},Object.assign(Error('连接暂不可用'),{retryable:true}),0);assert.equal(task.status,'waiting-network');assert.equal(task.retryAt,3000);assert.equal(photoTaskDelay({nm10514458:task},0),3000);
 task=deferPhotoTask(task,{retryable:true},3000);assert.equal(task.retryAt,18000);task=deferPhotoTask(task,{retryable:true},18000);assert.equal(task.retryAt,78000);task=deferPhotoTask(task,{retryable:true},78000);assert.equal(task.retryAt,258000);
 assert.equal(restorePhotoTasks({nm10514458:task},80000).nm10514458.retryAt,258000);assert.equal(photoTaskDelay({}),null);assert.equal(deferPhotoTask({},Error('参数无效')).status,'failed');
});
