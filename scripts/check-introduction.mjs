import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';
for(const file of ['README.md','site/index.html','site/guide.html']){
 const text=readFileSync(file,'utf8');
 const links=file.endsWith('.md')?[...text.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]):[...text.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1]);
 for(const link of links){if(/^(https?:|mailto:)/.test(link))continue;const [path,anchor]=link.split('#');const target=path?resolve(dirname(file),path):resolve(file);assert.ok(existsSync(target),file+' missing '+link);if(anchor&&target.endsWith('.html'))assert.ok(readFileSync(target,'utf8').includes('id="'+anchor+'"'),file+' anchor '+link);}
 if(file.endsWith('.html')){assert.ok(text.includes('lang="ko"'));assert.ok(text.includes('name="viewport"'));assert.ok(text.includes('<main'));}
}
console.log('PASS: README and site local links, navigation anchors, language and viewport.');
