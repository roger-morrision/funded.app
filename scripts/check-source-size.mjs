import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_LIMITS = Object.freeze({ lines: 500, bytes: 40 * 1024 });
export const MAX_SOURCE_LINES = 1000;
const CODE_EXTENSION = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html|vue|svelte|rs|py|ps1|psm1|psd1|sh|sql|ya?ml|toml)$/i;
const RUNTIME_EXTENSION = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html|vue|svelte|rs|py|ps1|psm1|psd1|sh|sql)$/i;
const ROOT_OUTPUT_DIRECTORIES = new Set(['target', 'dist', 'build', 'coverage', 'vendor', 'tmp', 'test-results', '.tmp-ui-evidence']);

function excludedDirectory(relative, name) {
  if (name === 'node_modules' || name === '.git') return true;
  if (!relative && ROOT_OUTPUT_DIRECTORIES.has(name)) return true;
  // Cargo output is generated; a source directory such as src/target is not.
  return (relative === 'contracts' || relative.startsWith('contracts/')) && name === 'target';
}

function maintainedCodeFile(name) {
  return CODE_EXTENSION.test(name) || /^(?:Dockerfile(?:\..+)?|.+\.Dockerfile)$/i.test(name);
}

export function sourceSize(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  return {
    lines: normalized ? normalized.split('\n').length - Number(normalized.endsWith('\n')) : 0,
    bytes: Buffer.byteLength(normalized),
  };
}

export function exceedsSourceBudget(size, legacy = {}) {
  return Object.keys(SOURCE_LIMITS).filter(key => size[key] > (key === 'lines'
    ? Math.min(MAX_SOURCE_LINES, Math.max(SOURCE_LIMITS[key], legacy[key] || 0))
    : Math.max(SOURCE_LIMITS[key], legacy[key] || 0)));
}

export async function runtimeSourceFiles(root) {
  // Git knows about checkout-specific ignored overlays and generated files.
  // Keep the directory walk below for standalone source-structure fixtures.
  try {
    const prefix = execFileSync('git', ['-C', root, 'rev-parse', '--show-prefix'],
      { stdio:['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
    // An enclosing checkout must not supply the inventory for a standalone root.
    if (!prefix) {
      const listed = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others',
        '--exclude-standard', '-z'], { stdio:['ignore', 'pipe', 'ignore'] }).toString('utf8');
      const candidates = [...new Set(listed.split('\0').filter(Boolean))]
        .filter(file => maintainedCodeFile(basename(file)));
      const present = await Promise.all(candidates.map(async file => {
        try { return (await stat(resolve(root, file))).isFile() ? file : null; }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      }));
      return present.filter(Boolean).sort();
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.status !== 128) throw error;
  }
  const files = [];
  async function collect(relative) {
    let entries;
    try { entries = await readdir(resolve(root, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !excludedDirectory(relative, entry.name)) await collect(path);
      else if (entry.isFile() && maintainedCodeFile(entry.name)) files.push(path);
    }
  }
  await collect('');
  return files.sort();
}

export async function checkSourceSizes(root) {
  const baseline = JSON.parse(await readFile(resolve(root, 'config/source-size-baseline.json'), 'utf8'));
  const files = await runtimeSourceFiles(root);
  const failures = [];
  for (const file of files) {
    const size = sourceSize(await readFile(resolve(root, file), 'utf8'));
    const runtime = RUNTIME_EXTENSION.test(file) && (!file.includes('/') || /^(src|styles|server)\//.test(file));
    const exceeded = runtime ? exceedsSourceBudget(size, baseline.files[file])
      : size.lines > MAX_SOURCE_LINES ? ['lines'] : [];
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
  } else console.log(`Source size budgets passed for ${result.files} maintained code files (hard maximum: ${MAX_SOURCE_LINES} lines).`);
}
