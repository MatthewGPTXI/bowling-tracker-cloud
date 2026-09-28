import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const files=[...fs.readdirSync('.').filter(file=>file.endsWith('.js') && file!=='service-worker.js'),...fs.readdirSync('modules').filter(file=>file.endsWith('.js')).map(file=>'modules/'+file)];
const worker=fs.readFileSync('service-worker.js','utf8');
const graph=new Map();
for(const file of files) {
  const source=fs.readFileSync(file,'utf8');
  assert(worker.includes(`'./${file}'`),`${file} must be in the atomic offline cache`);
  if(file!=='main.js')assert(!/window\.Bowling\w+/.test(source),`${file} must import its dependencies`);
  if(file!=='ui.js')assert(!/\.showModal\(/.test(source),`${file} must use the shared dialog controller`);
  const dependencies=[...source.matchAll(/(?:import|export)[^\n]*?from ['"](\.[^'"]+)['"]/g)].map(match=>path.normalize(path.join(path.dirname(file),match[1])));
  graph.set(file,dependencies);
}
const done=new Set();
function visit(file,stack=[]) {
  assert(!stack.includes(file),'Circular imports: '+[...stack,file].join(' → '));
  if(done.has(file))return;
  for(const dependency of graph.get(file)||[])visit(dependency,[...stack,file]);
  done.add(file);
}
files.forEach(file=>visit(file));
const workflow=fs.readFileSync('.github/workflows/ci.yml','utf8');
assert(workflow.includes('needs: test'));assert(workflow.includes('run: npm test'));
assert(!fs.readFileSync('app.js','utf8').includes('APP_VERSION'));
console.log('PASS architecture: acyclic ES imports, complete offline module cache, shared dialog entry and test-gated deployment.');
