import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { browserSourceDigest } from './browser-source-digest.mjs';

const directory = await mkdtemp(join(tmpdir(), 'funded-manifest-'));
const run = (command, args, env = {}) => spawnSync(command, args, { cwd: directory, encoding: 'utf8',
  env: { ...process.env, GITHUB_SHA: '', VITE_SOLANA_CLUSTER: 'devnet', VITE_ALLOW_MAINNET: 'false', ...env } });
const execute = (args = [], env = {}) => run(process.execPath, ['scripts/release-manifest.mjs', ...args], env);
const report = async () => JSON.parse(await readFile(join(directory, 'dist/release.json'), 'utf8'));
try {
  for (const name of ['server', 'scripts', 'db', 'dist']) await mkdir(join(directory, name));
  await copyFile(resolve('scripts/release-manifest.mjs'), join(directory, 'scripts/release-manifest.mjs'));
  await copyFile(resolve('scripts/browser-source-digest.mjs'), join(directory, 'scripts/browser-source-digest.mjs'));
  for (const [name, contents] of Object.entries({ 'package.json': '{"version":"0.1.0"}', 'package-lock.json': '{}',
    'dist/index.html': '<!doctype html>', 'dist/build-settings.json': JSON.stringify({ schemaVersion: 1, cluster: 'devnet', exploreCluster: 'devnet', mainnetEnabled: false, devWalletEnabled: false }), '.gitignore': 'dist/\n', 'db/schema.sql': 'SELECT 1;' })) await writeFile(join(directory, name), contents);
  for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Canonical fixture']]) {
    const result = run('git', args); assert.equal(result.status, 0, result.stderr);
  }
  const fixtureSettings = { schemaVersion: 1, cluster: 'devnet', exploreCluster: 'devnet', mainnetEnabled: false, devWalletEnabled: false, sourceDigest: await browserSourceDigest(directory) };
  await writeFile(join(directory, 'dist/build-settings.json'), JSON.stringify(fixtureSettings));
  assert.equal(execute().status, 0);
  const clean = await report();
  assert.equal(clean.releaseEligible, true);
  assert.match(clean.source, /^[a-f0-9]{40}$/);
  assert.equal(new Set(Object.values(clean.components).map(component => component.source)).size, 1);
  assert.ok(clean.sourceFiles.some(file => file.path === 'db/schema.sql'));
  assert.notEqual(execute([], { GITHUB_SHA: '0'.repeat(40) }).status, 0, 'Reject unrelated CI revision');
  await writeFile(join(directory, 'server/changed.mjs'), 'export const changed=true;');
  assert.notEqual(execute().status, 0, 'Reject untracked source');
  assert.equal(execute(['--allow-dirty']).status, 0);
  const local = await report();
  assert.equal(local.releaseEligible, false);
  assert.equal(local.source, null);
  assert.equal(local.dirty, true);
  assert.notEqual(local.sourceDigest, clean.sourceDigest);
  assert.notEqual(execute(['--allow-dirty'], { VITE_SOLANA_CLUSTER: 'mainnet-beta' }).status, 0);
  assert.notEqual(execute(['--allow-dirty'], { VITE_ALLOW_MAINNET: 'true' }).status, 0);
  await writeFile(join(directory, 'dist/build-settings.json'), JSON.stringify({ schemaVersion: 1, cluster: 'mainnet-beta', exploreCluster: 'mainnet-beta', mainnetEnabled: true }));
  assert.notEqual(execute(['--allow-dirty']).status, 0, 'Reject a previously built Mainnet bundle even with a Devnet manifest environment');
  await writeFile(join(directory, 'dist/build-settings.json'), JSON.stringify(fixtureSettings));
  await writeFile(join(directory, 'browser.js'), 'export const updated = true;');
  assert.notEqual(execute(['--allow-dirty']).status, 0, 'Reject browser source changed after build');
  await rm(join(directory, 'browser.js'));
  await rm(join(directory, 'server/changed.mjs'));
  const amend = run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--amend', '-qm', 'Local review snapshot of abc123']);
  assert.equal(amend.status, 0, amend.stderr);
  assert.notEqual(execute().status, 0, 'Reject synthetic source identity');
  console.log('Release manifest checks passed: canonical provenance, dirty/synthetic rejection, component identity, source hashes and Devnet isolation.');
} finally { await rm(directory, { recursive: true, force: true }); }
