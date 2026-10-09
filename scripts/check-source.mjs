import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [];
async function collect(directory, recursive = true) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && recursive) await collect(path);
    else if (entry.isFile() && /\.(?:mjs|js)$/.test(path)) files.push(path);
  }
}
await collect('.', false);
for (const directory of ['src', 'server', 'scripts', 'tests']) await collect(directory);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
