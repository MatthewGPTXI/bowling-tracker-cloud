import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const kind = process.argv[2];
if (!['unit', 'browser'].includes(kind)) throw new Error('Choose unit or browser');
const files = readdirSync(new URL('../tests/', import.meta.url)).filter(file => kind === 'browser'
  ? file.endsWith('-browser.mjs') : file.endsWith('.cjs') || file.endsWith('.test.mjs')).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['tests/' + file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Passed ${files.length} ${kind} suites.`);
