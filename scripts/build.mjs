import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
await cp(new URL('public/', root), output, {recursive: true});

// Give changed UI assets new URLs so existing installations see each update.
let html = await readFile(new URL('index.html', output), 'utf8');
const version = createHash('sha256');
for (const file of ['style.css', 'app.js', 'reading.js']) {
  const contents = await readFile(new URL(file, output));
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  version.update(contents);
  html = html.replaceAll(`./${file}"`, `./${file}?v=${hash}"`);
}
await writeFile(new URL('index.html', output), html);
const worker = await readFile(new URL('sw.js', output), 'utf8');
await writeFile(new URL('sw.js', output), worker.replace(/const CACHE='[^']+';/, `const CACHE='isolate-pages-${version.digest('hex').slice(0, 12)}';`));
await writeFile(new URL('.nojekyll', output), '');
console.log('Built GitHub Pages Web App in dist/');
