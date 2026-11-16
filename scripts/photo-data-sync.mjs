import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function parseJsonStrict(raw,label){
 if(typeof raw!=='string'||/^(?:<<<<<<<|=======|>>>>>>>)/m.test(raw))throw Error('冲突或无效 JSON：'+label);
 return JSON.parse(raw);
}
export function mergePhotoDataSnapshot({upstream,local,changedSubjects={}}){
 const subjectsMap=new Map((upstream.subjectsList||[]).filter(row=>row?.id).map(row=>[row.id,row]));
 for(const row of local.subjectsList||[])if(row?.id){const old=subjectsMap.get(row.id);subjectsMap.set(row.id,old?{...old,...row}:row);}
 const externalIds={...(upstream.externalIds||{})};
 for(const [id,entry]of Object.entries(local.externalIds||{})){
  const prev=externalIds[id];
  if(!prev||Date.parse(entry?.fetchedAt||0)>=Date.parse(prev?.fetchedAt||0))externalIds[id]=entry;
 }
 const indexSubjects={...(upstream.index?.subjects||{})};
 for(const [id,record]of Object.entries(changedSubjects)){
  if(!record?.item?.id)continue;
  indexSubjects[id]={title:record.item.title||'',path:'subjects/'+id+'.json',checkedAt:record.checkedAt,counts:Object.fromEntries(Object.entries(record.sources||{}).map(([key,value])=>[key,Array.isArray(value?.images)?value.images.length:0]))};
 }
 return {subjectsList:[...subjectsMap.values()],externalIds,index:{version:1,subjects:indexSubjects,updatedAt:local.index?.updatedAt||upstream.index?.updatedAt||new Date().toISOString()}};
}
export async function assertValidPhotoData(rootUrl=new URL('../photo-data/',import.meta.url)){
 for(const name of ['subjects.json','index.json','external-ids.json'])parseJsonStrict(await readFile(new URL(name,rootUrl),'utf8'),'photo-data/'+name);
 const dir=new URL('subjects/',rootUrl),files=await readdir(dir);
 for(const name of files)if(name.endsWith('.json')){
  const data=parseJsonStrict(await readFile(new URL(name,dir),'utf8'),'photo-data/subjects/'+name);
  if(!data?.item?.id||!data?.sources)throw Error('条目结构缺失：'+name);
 }
 return files.filter(name=>name.endsWith('.json')).length;
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const gitBytes=(...args)=>execFileSync('git',args);
async function readJsonFile(url,fallback){try{return parseJsonStrict(await readFile(url,'utf8'),url.pathname);}catch{return fallback;}}
async function main(){
 const message=process.argv[2]||'Refresh public photo metadata',root=new URL('../photo-data/',import.meta.url),branch=process.env.GITHUB_REF_NAME||git('rev-parse','--abbrev-ref','HEAD');
 await assertValidPhotoData(root);
 git('config','user.name','isolate-photo-data');
 git('config','user.email','isolate-photo-data@users.noreply.github.com');
 const changedSubjectPaths=gitBytes('ls-files','-z','--modified','--others','--exclude-standard','--','photo-data/subjects').toString('utf8').split('\0').filter(path=>path.endsWith('.json'));
 const changedImagePaths=gitBytes('ls-files','-z','--modified','--others','--exclude-standard','--','photo-data/images').toString('utf8').split('\0').filter(Boolean);
 const local={subjectsList:await readJsonFile(new URL('subjects.json',root),[]),externalIds:await readJsonFile(new URL('external-ids.json',root),{}),index:await readJsonFile(new URL('index.json',root),{version:1,subjects:{}})};
 const changedSubjects={},imageBuffers=new Map();
 for(const rel of changedSubjectPaths){const id=rel.replace(/^photo-data\/subjects\/|\.json$/g,'');changedSubjects[id]=parseJsonStrict(await readFile(new URL('../'+rel,import.meta.url),'utf8'),rel);}
 for(const rel of changedImagePaths)imageBuffers.set(rel,await readFile(new URL('../'+rel,import.meta.url)));

 for(let attempt=0;attempt<3;attempt++){
  git('fetch','origin',branch);
  const localHead=git('rev-parse','HEAD'),remoteHead=git('rev-parse','origin/'+branch);
  if(localHead!==remoteHead){
   git('reset','--hard','origin/'+branch);
   const upstream={subjectsList:await readJsonFile(new URL('subjects.json',root),[]),externalIds:await readJsonFile(new URL('external-ids.json',root),{}),index:await readJsonFile(new URL('index.json',root),{version:1,subjects:{}})};
   const merged=mergePhotoDataSnapshot({upstream,local,changedSubjects});
   for(const [id,record]of Object.entries(changedSubjects))await writeFile(new URL('subjects/'+id+'.json',root),JSON.stringify(record,null,2)+'\n');
   for(const [rel,bytes]of imageBuffers.entries()){const target=new URL('../'+rel,import.meta.url);await mkdir(dirname(fileURLToPath(target)),{recursive:true});await writeFile(target,bytes);}
   await writeFile(new URL('subjects.json',root),JSON.stringify(merged.subjectsList,null,2)+'\n');
   await writeFile(new URL('external-ids.json',root),JSON.stringify(merged.externalIds,null,2)+'\n');
   await writeFile(new URL('index.json',root),JSON.stringify(merged.index,null,2)+'\n');
  }
  await assertValidPhotoData(root);
  git('add','photo-data/');
  if(spawnSync('git',['diff','--cached','--quiet'],{stdio:'ignore'}).status===0)return;
  git('commit','-m',message);
  if(spawnSync('git',['push'],{stdio:'inherit'}).status===0)return;
  git('reset','--soft','HEAD~1');
 }
 throw Error('Failed to push photo-data after 3 semantic merge attempts');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
