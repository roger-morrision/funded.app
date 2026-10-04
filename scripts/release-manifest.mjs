import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { browserSourceDigest } from './browser-source-digest.mjs';

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const localReport = process.argv.includes('--allow-dirty');
const dirty = Boolean(git(['status', '--porcelain', '--untracked-files=normal']));
const revision = git(['rev-parse', 'HEAD']);
const syntheticSnapshot = git(['log', '-1', '--format=%s']).startsWith('Local review snapshot of ');
if (!localReport && (dirty || syntheticSnapshot)) throw new Error('Release manifests require a clean canonical checkout. Use --allow-dirty only for a local, non-release report.');
if (!localReport && process.env.GITHUB_SHA && process.env.GITHUB_SHA !== revision) throw new Error('CI revision does not match the checked-out source.');
const cluster = process.env.VITE_SOLANA_CLUSTER || 'devnet';
if (cluster !== 'devnet' || String(process.env.VITE_ALLOW_MAINNET).toLowerCase() === 'true') throw new Error('This release pipeline supports Devnet only.');
const builtSettings = JSON.parse(await readFile('dist/build-settings.json', 'utf8'));
if (builtSettings.schemaVersion !== 1 || builtSettings.cluster !== cluster || builtSettings.exploreCluster !== cluster || builtSettings.mainnetEnabled !== false) throw new Error('Built browser settings do not match the Devnet release profile. Rebuild before generating a manifest.');
if (builtSettings.sourceDigest !== await browserSourceDigest(process.cwd())) throw new Error('Browser source differs from the built bundle. Rebuild before generating a release manifest.');
if (!localReport && builtSettings.devWalletEnabled !== false) throw new Error('Public releases must disable the server-held test wallet.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function scan(directory, exclude = () => false) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (exclude(path)) continue;
    if (entry.isDirectory()) rows.push(...await scan(path, exclude));
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      rows.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
const assets = (await scan('dist', path => path === 'dist/release.json')).map(row => ({ ...row, path: row.path.slice(5) }));
if (!assets.some(row => row.path === 'index.html')) throw new Error('Build the browser application before generating its release manifest.');
const sourceFiles = (await Promise.all(['server', 'scripts', 'db'].map(directory => scan(directory)))).flat();
const rootFiles = (await readdir('.', { withFileTypes: true })).filter(entry => entry.isFile() && (/\.(?:mjs|js|css|html)$/.test(entry.name) || ['package.json', 'package-lock.json'].includes(entry.name)) && !entry.name.startsWith('.'));
for (const entry of rootFiles) {
  const bytes = await readFile(entry.name);
  sourceFiles.push({ path: entry.name, bytes: bytes.length, sha256: sha256(bytes) });
}
sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
const sourceDigest = sha256(JSON.stringify(sourceFiles));
const source = localReport ? null : revision;
const manifest = { version: 2, source, localRevision: localReport ? revision : undefined,
  releaseEligible: !localReport, dirty, syntheticSnapshot, node: process.version,
  applicationVersion: JSON.parse(await readFile('package.json', 'utf8')).version,
  lockfileSha256: sha256(await readFile('package-lock.json')),
  cluster, mainnetEnabled: false, builtSettings, sourceDigest,
  components: Object.fromEntries(['browser', 'api', 'workers'].map(name => [name, { source, sourceDigest }])),
  sourceFiles, assets };
await writeFile('dist/release.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Recorded ${assets.length} asset hashes and ${sourceFiles.length} source hashes for ${source || 'local report (not a release)'}.`);
