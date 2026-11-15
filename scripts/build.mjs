import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);await rm(new URL('dist/',root),{recursive:true,force:true});await mkdir(new URL('dist/',root),{recursive:true});await cp(new URL('public/',root),new URL('dist/',root),{recursive:true});await writeFile(new URL('dist/.nojekyll',root),'');console.log('Built GitHub Pages Web App in dist/');
