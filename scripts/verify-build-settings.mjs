import assert from 'node:assert/strict';
import viteConfig, { browserBuildSettings } from '../vite.config.js';

const defaults = browserBuildSettings({}, {});
assert.deepEqual(defaults, { schemaVersion: 1, cluster: 'devnet', exploreCluster: 'devnet', mainnetEnabled: false, mainnetReadOnly: false, devWalletEnabled: false });
const fromFile = browserBuildSettings({ VITE_SOLANA_CLUSTER: 'mainnet-beta', VITE_ALLOW_MAINNET: 'TRUE', VITE_MAINNET_READ_ONLY: 'TRUE', VITE_DEV_MODE: 'true' }, {});
assert.equal(fromFile.mainnetReadOnly, true);
assert.equal(fromFile.devWalletEnabled, false);
assert.equal(browserBuildSettings({ VITE_SOLANA_CLUSTER: 'mainnet-beta' }, { VITE_SOLANA_CLUSTER: 'devnet' }).cluster, 'devnet');
assert.throws(() => browserBuildSettings({ VITE_SOLANA_CLUSTER: 'devnet', VITE_EXPLORE_CLUSTER: 'mainnet-beta' }, {}));
assert.throws(() => browserBuildSettings({ VITE_SOLANA_CLUSTER: 'unknown' }, {}));
assert.equal(typeof viteConfig, 'function');
console.log('Browser build settings: safe defaults, environment precedence, file-based read-only mode and network consistency passed.');

const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { prunePosterSources } = await import('./prune-build-sources.mjs');
const root = await mkdtemp(join(tmpdir(), 'funded-build-assets-'));
try {
  await mkdir(join(root, 'dist/posters'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<img src="/posters/needed.png">');
  for (const file of ['archive.png', 'needed.png', 'optimized.webp']) await writeFile(join(root, 'dist/posters', file), 'fixture');
  const report = await prunePosterSources({ root, outDir: 'dist' });
  assert.equal(report.omittedFiles, 1);
  assert.equal(report.omittedBytes, 7);
  await assert.rejects(readFile(join(root, 'dist/posters/archive.png')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'dist/posters/needed.png'), 'utf8'), 'fixture');
  assert.equal(await readFile(join(root, 'dist/posters/optimized.webp'), 'utf8'), 'fixture');
  await writeFile(join(root, 'dynamic.js'), 'const image = `/posters/${name}-labeled.png`;');
  await writeFile(join(root, 'dist/posters/archive.png'), 'fixture');
  assert.equal((await prunePosterSources({ root, outDir: 'dist' })).omittedFiles, 0);
  await assert.rejects(prunePosterSources({ root, outDir: 'public' }), /source artwork/);
  console.log('Build artwork: archival PNG pruning, referenced images, WebP preservation, dynamic-path fallback and source safety passed.');
} finally { await rm(root, { recursive: true, force: true }); }

// Shared browser policy lives below config/, so changes there must invalidate bundles.
const { browserSourceDigest } = await import('./browser-source-digest.mjs');
const digestRoot = await mkdtemp(join(tmpdir(), 'funded-browser-digest-'));
try {
  await mkdir(join(digestRoot, 'config'));
  const policyPath = join(digestRoot, 'config/protocol-fee-split.js');
  await writeFile(policyPath, 'export const policy = 1;');
  const before = await browserSourceDigest(digestRoot);
  await writeFile(policyPath, 'export const policy = 2;');
  assert.notEqual(await browserSourceDigest(digestRoot), before);
  console.log('Browser source identity includes nested shared policy configuration.');
} finally { await rm(digestRoot, { recursive: true, force: true }); }
