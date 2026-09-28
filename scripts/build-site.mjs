import { readFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
// Publish only the offline application, never tests or repository metadata.
const worker = readFileSync('service-worker.js', 'utf8');
const assets = [...worker.match(/const APP_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/(.*?)'/g)]
  .map(match => match[1]).filter(Boolean);
rmSync('dist', {recursive: true, force: true});
mkdirSync('dist');
for (const asset of new Set([...assets, 'service-worker.js', 'build.json'])) {
  cpSync(asset, 'dist/' + asset, {recursive: true});
}
