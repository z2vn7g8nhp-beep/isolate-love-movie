import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPhotoSource} from '../public/photo-client.js';
import {composePhotoService} from '../scripts/compose-photo-service.mjs';

test('one click requests the selected source without sending personal notes or nicknames',async()=>{
 const old=globalThis.fetch;let requested;
 globalThis.fetch=async url=>{requested=new URL(url);return {ok:true,json:async()=>({source:'pinterest',status:'ok',images:[{url:'https://i.pinimg.com/564x/a/b/c.jpg',source:'Pinterest 搜索',pageUrl:'https://www.pinterest.com/pin/123/'}],nextCursor:'next'})};};
 try{const result=await fetchPhotoSource({id:'tt1',kind:'film',title:'Film',note:'my private note',nickname:'my private nickname'},{source:'pinterest',cursor:'prior'});assert.equal(requested.searchParams.get('source'),'pinterest');assert.equal(requested.searchParams.get('after'),'prior');assert.equal(requested.searchParams.has('note'),false);assert.equal(requested.searchParams.has('nickname'),false);assert.equal(result.images.length,1);assert.equal(result.nextCursor,'next');}finally{globalThis.fetch=old;}
});

test('client rejects results claiming a different source and reports backend failure',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({source:'douban',status:'ok',images:[]})});try{await assert.rejects(fetchPhotoSource({id:'tt1',title:'Film',kind:'film'},{source:'imdb'}),/来源响应异常/);globalThis.fetch=async()=>({ok:false,status:429});await assert.rejects(fetchPhotoSource({id:'tt1',title:'Film',kind:'film'},{source:'imdb'}),/请求较多/);}finally{globalThis.fetch=old;}
});

test('sharing adapter keeps existing handlers and isolates the new URL namespace',()=>{
 const original="import {Database} from 'bun:sqlite';\nfunction handle(req){return new Response('original app')}\nBun.serve({port:3000,fetch:handle});";
 const reader="export async function handlePhotoRequest(req){return new Response('photo reader')}\nif(globalThis.Bun&&import.meta.main)Bun.serve({fetch:handlePhotoRequest});";
 const result=composePhotoService(original,reader);assert.ok(result.includes("function handle(req){return new Response('original app')}"));assert.ok(result.includes("url.pathname.startsWith('/isolate/')"));assert.ok(result.includes('return handle(request)'));assert.equal(result.match(/Bun\.serve\(/g).length,1);assert.throws(()=>composePhotoService(result,reader),/review/);
});
