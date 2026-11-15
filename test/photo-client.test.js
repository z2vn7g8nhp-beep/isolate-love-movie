import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPhotoSource} from '../public/photo-client.js';

test('one click requests the selected source without sending personal notes or nicknames',async()=>{
 const old=globalThis.fetch;let requested;
 globalThis.fetch=async url=>{requested=new URL(url);return {ok:true,json:async()=>({source:'pinterest',status:'ok',images:[{url:'https://i.pinimg.com/564x/a/b/c.jpg',source:'Pinterest 搜索',pageUrl:'https://www.pinterest.com/pin/123/'}],nextCursor:'next'})};};
 try{const result=await fetchPhotoSource({id:'tt1',kind:'film',title:'Film',note:'my private note',nickname:'my private nickname'},{source:'pinterest',cursor:'prior',endpoint:'https://photos.example/v1/photos'});assert.equal(requested.searchParams.get('source'),'pinterest');assert.equal(requested.searchParams.get('after'),'prior');assert.equal(requested.searchParams.has('note'),false);assert.equal(requested.searchParams.has('nickname'),false);assert.equal(result.images.length,1);assert.equal(result.nextCursor,'next');}finally{globalThis.fetch=old;}
});

test('client rejects results claiming a different source and reports backend failure',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({source:'douban',status:'ok',images:[]})});try{await assert.rejects(fetchPhotoSource({id:'tt1',title:'Film',kind:'film'},{source:'imdb',endpoint:'https://photos.example/v1/photos'}),/来源响应异常/);globalThis.fetch=async()=>({ok:false,status:429});await assert.rejects(fetchPhotoSource({id:'tt1',title:'Film',kind:'film'},{source:'imdb',endpoint:'https://photos.example/v1/photos'}),/请求较多/);}finally{globalThis.fetch=old;}
});

test('an unconfigured independent service never falls back to another project',async()=>{const old=globalThis.fetch;let called=false;globalThis.fetch=()=>{called=true;throw Error('must not call');};try{await assert.rejects(fetchPhotoSource({id:'tt1',title:'Film',kind:'film'},{source:'imdb',endpoint:''}),/尚未部署/);assert.equal(called,false);}finally{globalThis.fetch=old;}});
