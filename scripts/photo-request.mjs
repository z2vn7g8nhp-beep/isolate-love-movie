import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PHOTO_REQUEST_MARKER} from '../public/photo-client.js';
import {fromImdb} from '../public/data-client.js';

export function parsePhotoRequest(body){
 if(typeof body!=='string')throw Error('不是 ISOLATE 补图请求');body=body.replaceAll('\r\n','\n');
 if(!body.startsWith(PHOTO_REQUEST_MARKER+'\n'))throw Error('不是 ISOLATE 补图请求');
 const match=body.match(/^IMDb: ((?:tt|nm)\d{5,12})\r?$/m);if(!match)throw Error('请求缺少有效的 IMDb 编号');return match[1];
}
export async function verifyPhotoSubject(id,{fetcher=fetch}={}){
 if(!/^(tt|nm)\d{5,12}$/.test(id||''))throw Error('IMDb 编号无效');
 const response=await fetcher('https://v3.sg.media-imdb.com/suggestion/'+id[0]+'/'+id+'.json',{signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('暂时无法核对 IMDb 条目，请稍后重新打开此请求');
 const data=await response.json(),entry=data.d?.find(row=>row.id===id);if(!entry||!entry.l)throw Error('未找到与请求编号一致的 IMDb 条目');
 const item=fromImdb(entry);return {id:item.id,title:item.title,kind:item.kind,...(item.year?{year:item.year}:{})};
}
export function registerPhotoSubject(subjects,item){
 const old=subjects.find(row=>row.id===item.id);return old?subjects.map(row=>row===old?{...row,...item}:row):[...subjects,item];
}
async function main(){
 let id=process.env.PHOTO_REQUEST_ID;
 if(process.env.GITHUB_EVENT_NAME==='issues'){
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(!['OWNER','MEMBER','COLLABORATOR'].includes(event.issue?.author_association))throw Error('仅仓库维护者可发起采集');
  id=parsePhotoRequest(event.issue.body);
 }
 const item={...await verifyPhotoSubject(id),cachePhotos:true},path=new URL('../photo-data/subjects.json',import.meta.url),subjects=JSON.parse(await readFile(path,'utf8'));
 await writeFile(path,JSON.stringify(registerPhotoSubject(subjects,item),null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,'subject_id='+item.id+'\n',{flag:'a'});
 console.log(JSON.stringify({stage:'registered',...item}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
