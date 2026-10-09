import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_LIMITS = Object.freeze({ lines: 500, bytes: 40 * 1024 });

export function sourceSize(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  return {
    lines: normalized ? normalized.split('\n').length - Number(normalized.endsWith('\n')) : 0,
    bytes: Buffer.byteLength(normalized),
  };
}

export function exceedsSourceBudget(size, legacy = {}) {
  return Object.keys(SOURCE_LIMITS).filter(key => size[key] > Math.max(SOURCE_LIMITS[key], legacy[key] || 0));
}

export async function runtimeSourceFiles(root) {
  const files = [];
  async function collect(relative, recursive) {
    for (const entry of await readdir(resolve(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && recursive) await collect(path, true);
      else if (entry.isFile() && /\.(?:js|mjs|css|html)$/.test(entry.name)) files.push(path);
    }
  }
  await collect('', false);
  for (const directory of ['src', 'styles', 'server']) await collect(directory, true);
  return files.sort();
}

export async function checkSourceSizes(root) {
  const baseline = JSON.parse(await readFile(resolve(root, 'config/source-size-baseline.json'), 'utf8'));
  const files = await runtimeSourceFiles(root);
  const failures = [];
  for (const file of files) {
    const size = sourceSize(await readFile(resolve(root, file), 'utf8'));
    const exceeded = exceedsSourceBudget(size, baseline.files[file]);
    if (exceeded.length) failures.push(`${file}: ${size.lines} lines, ${size.bytes} bytes (${exceeded.join(', ')} over budget)`);
  }
  return { files: files.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await checkSourceSizes(process.cwd());
  if (result.failures.length) {
    console.error(result.failures.join('\n'));
    console.error('Extract a focused module. See docs/code-structure.md before changing the legacy baseline.');
    process.exitCode = 1;
  } else console.log(`Source size budgets passed for ${result.files} runtime files.`);
}
