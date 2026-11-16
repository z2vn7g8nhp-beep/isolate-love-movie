import {mkdir,readFile,writeFile,access,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {photoKey} from '../public/collection.js';

const run=promisify(execFile),base='https://z2vn7g8nhp-beep.github.io/isolate-love-movie/photo-data/';
export async function cachePhotoPreviews(images,item,{root=new URL('../photo-data/',import.meta.url),limit=48}={}){
 if(!/^(tt|nm)\d{5,12}$/.test(item.id||''))throw Error('图片缓存条目标识无效');
 const directory=new URL('images/'+item.id+'/',root);await mkdir(directory,{recursive:true});
 const existing=new Set((await readdir(directory)).filter(name=>/^[a-f0-9]{24}\.webp$/.test(name)));
 let stored=0;const result=[];
 for(const image of images){
  if(!/^https:\/\/img\d*\.doubanio\.com\/view\/photo\//.test(image.url)||stored>=limit){result.push(image);continue;}
  const hash=createHash('sha256').update(photoKey(image.url)).digest('hex').slice(0,24),relative='images/'+item.id+'/'+hash+'.webp',target=new URL(relative,root);
  let available=false;try{await access(target);available=true;}catch{}
  if(!available&&existing.size>=limit){result.push(image);continue;}
  if(!available){let temp;try{
   const response=await fetch(image.url,{signal:AbortSignal.timeout(12000),headers:{referer:'https://m.douban.com/','user-agent':'Mozilla/5.0'}});
   if(!response.ok||!/^image\/(jpeg|png|webp)/i.test(response.headers.get('content-type')||'')||Number(response.headers.get('content-length'))>1_500_000)throw Error('公开预览暂不可用');
   const reader=response.body.getReader(),chunks=[];let bytes=0;while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1_500_000){await reader.cancel();throw Error('预览图片过大');}chunks.push(value);}
   temp=join(tmpdir(),'isolate-photo-'+item.id+'-'+hash);await writeFile(temp,Buffer.concat(chunks));await mkdir(new URL('./',target),{recursive:true});
   await run('python3',[fileURLToPath(new URL('./photo-preview.py',import.meta.url)),temp,fileURLToPath(target)],{timeout:10000});
   const output=await readFile(target);if(output.length>180000)throw Error('预览超出缓存大小限制');available=true;existing.add(hash+'.webp');
  }catch(error){await rm(target,{force:true});console.log(JSON.stringify({stage:'preview',subject:item.id,status:'unavailable',message:error.message.slice(0,100)}));}
  finally{if(temp)await rm(temp,{force:true});}}
  if(available){stored++;result.push({...image,cachedUrl:base+relative,thumbnail:base+relative});}else result.push(image);
 }
 console.log(JSON.stringify({stage:'previews',subject:item.id,cached:stored,limit}));return result;
}
