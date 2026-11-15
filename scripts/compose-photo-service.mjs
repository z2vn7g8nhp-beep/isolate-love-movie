import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
// Compose locally first; this script never deploys or changes an existing service.
export function composePhotoService(original,reader){
 if(original.includes('ISOLATE_READER_BEGIN'))throw Error('Existing image reader found; review before replacing it');
 const needle='fetch:handle}';if(original.split(needle).length!==2)throw Error('Existing HTTP handler differs from the reviewed version');
 const serverAt=original.indexOf('Bun.serve(');if(serverAt<0)throw Error('Existing HTTP server not found');
 const module=reader.replace(/^export /gm,'').replace(/^if\(globalThis\.Bun&&import\.meta\.main\)Bun\.serve\([^\n]+\);?\s*$/m,'');
 const isolated='\n// ISOLATE_READER_BEGIN: self-contained route, separate cache and rate limits.\nconst isolatePhotoHandler=(()=>{\n'+module+'\nreturn handlePhotoRequest;\n})();\n// ISOLATE_READER_END\n';
 return (original.slice(0,serverAt)+isolated+original.slice(serverAt)).replace(needle,"fetch:request=>{const url=new URL(request.url);if(url.pathname.startsWith('/isolate/')){url.pathname=url.pathname.slice('/isolate'.length);return isolatePhotoHandler(new Request(url,request));}return handle(request);}}");
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/compose-photo-service.mjs original.mjs output.mjs');
 const original=await readFile(input,'utf8'),reader=await readFile(new URL('../server/photo-api.mjs',import.meta.url),'utf8');await writeFile(output,composePhotoService(original,reader));console.log('Prepared isolated photo route; nothing deployed.');
}
