// Inspect an explicitly selected local container; the only mutation is a unique
// data-directory probe that is removed immediately. No chain or X requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const container = process.argv[2];
if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Pass the local Devnet application container name.');
const expectedBuild = process.env.FUNDED_EXPECT_BUILD;
assert.ok(typeof expectedBuild === 'string' && expectedBuild.length > 0 && expectedBuild.length <= 128, 'FUNDED_EXPECT_BUILD must identify the expected source revision.');
const docker = args => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const [metadata] = JSON.parse(docker(['inspect', container]));
const [image] = JSON.parse(docker(['image', 'inspect', metadata.Image]));
assert.equal(metadata.State.Running, true, 'Application container must be running.');
assert.equal(metadata.HostConfig.ReadonlyRootfs, true, 'Release profile must use a read-only root filesystem.');
assert.match(String(metadata.Config.User), /^(?:node|1000)(?::(?:node|1000))?$/, 'Image must select the Node runtime user.');
assert.equal(metadata.Image, image.Id, 'Container must run the inspected immutable image.');
if (process.env.FUNDED_EXPECT_IMAGE) assert.equal(image.Id, process.env.FUNDED_EXPECT_IMAGE, 'Container image must match the expected immutable image.');
for (const config of [image.Config, metadata.Config]) {
  assert.equal(config.Labels?.['org.opencontainers.image.revision'], expectedBuild, 'Image and container labels must identify the expected revision.');
  assert.equal(config.Labels?.['org.opencontainers.image.source'], 'https://github.com/roger-morrision/funded.app');
  assert.equal(config.Env?.find(value => value.startsWith('FUNDED_BUILD_ID=')), `FUNDED_BUILD_ID=${expectedBuild}`, 'Build identity cannot differ between the image and runtime.');
}
const buildOnlyKeys = image.Config.Env.map(value => value.split('=', 1)[0]).filter(key => /^VITE_/.test(key)
  || /^(?:https?_proxy|all_proxy|no_proxy|NODE_EXTRA_CA_CERTS|NPM_CONFIG_CAFILE|npm_config_cafile|NPM_TOKEN|NODE_AUTH_TOKEN|GIT_AUTH_TOKEN)$/i.test(key));
assert.equal(buildOnlyKeys.length, 0, 'Build-only proxy, CA, token and browser-argument environment must not remain in the image.');
for (const mount of metadata.Mounts || []) {
  assert.ok(mount.Destination !== '/app' && (!mount.Destination.startsWith('/app/') || mount.Destination === '/app/data'), 'Runtime mounts cannot mask application source, dependencies or built assets.');
}
const check = `
import assert from 'node:assert/strict';
import { readFile, access, writeFile, unlink, stat, lstat, realpath, readdir } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { browserSourceDigest } from './scripts/browser-source-digest.mjs';
assert.equal(process.getuid(), 1000, 'Application must run as UID 1000');
assert.equal(process.cwd(), '/app');
assert.equal(process.env.FUNDED_BUILD_ID, ${JSON.stringify(expectedBuild)});
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.SOLANA_CLUSTER, 'devnet');
for (const key of ['DEV_MODE', 'DEVNET_TEST_MODE', 'SOLANA_KEEPER_CONFIGURED', 'SOLANA_REFERRAL_PAYOUT_CONFIGURED', 'FUNDED_MINT_FEE_ROUTER_ENABLED', 'FUNDED_BUYBACK_EXECUTOR_ENABLED', 'FUNDED_BOOST_ENABLED', 'RPC_ALLOW_AIRDROP', 'X_POST_ENABLED']) {
  assert.notEqual(process.env[key], 'true', key + ' must remain disabled during image verification');
}
const protectedPaths = ['.', 'server', 'server/index.mjs', 'db/schema.sql', 'scripts/migrate-postgres.mjs', 'scripts/browser-source-digest.mjs', 'package.json', 'node_modules', 'node_modules/pg/package.json', 'vendor/bigint-buffer', 'dist', 'dist/build-settings.json'];
for (const path of protectedPaths) {
  const info = await stat(path);
  assert.equal(info.uid, 0, path + ' must remain root-owned');
  assert.equal(info.mode & 0o022, 0, path + ' must not be writable by group or others');
  await access(path, constants.R_OK | (info.isDirectory() ? constants.X_OK : 0));
  await assert.rejects(access(path, constants.W_OK), error => ['EACCES', 'EPERM', 'EROFS'].includes(error.code), path + ' must not be writable by the runtime user');
}
const data = await stat('/app/data'); assert.equal(data.uid, 1000, 'Data directory must belong to the runtime user');
const probe = '/app/data/.verification-' + randomUUID(); let created = false;
try { await writeFile(probe, 'local runtime probe', { flag: 'wx', mode: 0o600 }); created = true; }
finally { if (created) await unlink(probe); }
assert.equal(existsSync('/run/secrets/proxy_ca'), false, 'Build-only CA must not remain in the runtime image');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const name of Object.keys(pkg.devDependencies || {})) assert.equal(existsSync(join('node_modules', name)), false, name + ' must be pruned');
const bins = await readdir('node_modules/.bin'); assert.ok(bins.length > 0, 'Production dependency bins must remain installed');
for (const name of bins) {
  const path = join('node_modules/.bin', name); assert.equal((await lstat(path)).isSymbolicLink(), true, 'npm bin symlink must survive: ' + name);
  const target = await realpath(path); assert.ok(target.startsWith('/app/node_modules/'), 'Dependency executable must resolve inside installed dependencies');
  await access(path, constants.R_OK | constants.X_OK); assert.equal((await stat(path)).uid, 0);
}
assert.ok(bins.includes('uuid'), 'Known production CLI is required for the executable smoke test');
assert.match(execFileSync('./node_modules/.bin/uuid', ['--help'], { encoding: 'utf8' }), /uuid/i);
assert.equal((await lstat('node_modules/bigint-buffer')).isSymbolicLink(), true, 'Vendored dependency link must survive');
assert.equal(await realpath('node_modules/bigint-buffer'), resolve('vendor/bigint-buffer'));
await import('pg'); await import('bigint-buffer');
const settings = JSON.parse(await readFile('dist/build-settings.json', 'utf8'));
assert.equal(settings.cluster, 'devnet'); assert.equal(settings.exploreCluster, 'devnet');
assert.equal(settings.mainnetEnabled, false); assert.equal(settings.mainnetReadOnly, false); assert.equal(settings.devWalletEnabled, false);
assert.match(settings.sourceDigest, /^[a-f0-9]{64}$/);
assert.equal(settings.sourceDigest, await browserSourceDigest(process.cwd()), 'Image source must match its built browser');
console.log(JSON.stringify({ uid: process.getuid(), sourceReadable: true, sourceRootOwned: true, sourceAndDependenciesNotWritable: true, dataWritable: true, dataProbeRemoved: !existsSync(probe), buildCaAbsent: true, devDependenciesPruned: true, executableDependencyBins: bins, executableCliRan: true, vendoredSymlinkPreserved: true, build: process.env.FUNDED_BUILD_ID, browser: settings }));
`;
const runtime = JSON.parse(docker(['exec', container, 'node', '--input-type=module', '-e', check]));
console.log(JSON.stringify({ mode: 'Actual local Docker image and runtime inspection; no network requests', expectedBuild, imageId: image.Id,
  sourceRevision: image.Config.Labels['org.opencontainers.image.revision'], readOnlyRoot: true, sourceMountsUnmasked: true, buildEnvironmentAbsent: true, runtime }, null, 2));
