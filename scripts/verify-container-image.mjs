// Read-only image checks plus a uniquely named data-directory write probe.
// This command uses only the local Docker daemon and never submits a transaction.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const container = process.argv[2];
if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Pass the local Devnet application container name.');
const docker = args => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const [metadata] = JSON.parse(docker(['inspect', container]));
assert.equal(metadata.State.Running, true, 'Application container must be running.');
assert.equal(metadata.HostConfig.ReadonlyRootfs, true, 'Release profile must use a read-only root filesystem.');
assert.notEqual(metadata.Config.User, '0');
assert.notEqual(metadata.Config.User, 'root');
const check = `
import assert from 'node:assert/strict';
import { readFile, access, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { browserSourceDigest } from './scripts/browser-source-digest.mjs';
assert.ok(process.getuid() > 0, 'Application must run as non-root');
await access('server/index.mjs'); await access('scripts/migrate-postgres.mjs');
const path = '/app/data/.verification-' + randomUUID();
await writeFile(path, 'local runtime probe', { flag: 'wx', mode: 0o600 }); await unlink(path);
assert.equal(existsSync('/run/secrets/proxy_ca'), false, 'Build-only CA must not remain in the runtime image');
assert.equal(existsSync('node_modules/@playwright/test'), false, 'Browser test dependency must be pruned');
const settings = JSON.parse(await readFile('dist/build-settings.json', 'utf8'));
assert.equal(settings.cluster, 'devnet'); assert.equal(settings.mainnetEnabled, false); assert.equal(settings.devWalletEnabled, false);
assert.equal(settings.sourceDigest, await browserSourceDigest(process.cwd()), 'Image source must match its built browser');
console.log(JSON.stringify({ uid: process.getuid(), sourceReadable: true, dataWritable: true, buildCaAbsent: true, devDependenciesPruned: true, build: process.env.FUNDED_BUILD_ID, browser: settings }));
`;
const runtime = JSON.parse(docker(['exec', container, 'node', '--input-type=module', '-e', check]));
console.log(JSON.stringify({ imageId: metadata.Image, readOnlyRoot: true, runtime }, null, 2));
