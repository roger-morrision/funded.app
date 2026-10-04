import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { maintenanceLease } from '../scripts/maintenance-run-lock.mjs';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'funded-maintenance-'));
  try { await run(join(directory, 'lease.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function mutate(path, change) {
  const lease = JSON.parse(await readFile(path, 'utf8')); change(lease);
  await writeFile(path, JSON.stringify(lease));
}
test('maintenance guard serializes genuinely concurrent processes and checks ownership', async () => fixture(async path => {
  const attempts = Array.from({ length: 6 }, () => new Promise((resolveAttempt, reject) => {
    const child = spawn(process.execPath, [resolve('scripts/maintenance-run-lock.mjs'), 'acquire', '--path', path, '--owner-pid', String(process.pid)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { error += data; });
    child.on('error', reject); child.on('exit', code => {
      try { assert.ok([0, 2].includes(code), error); resolveAttempt(JSON.parse(output)); } catch (failure) { reject(failure); }
    });
  }));
  const results = await Promise.all(attempts);
  const winners = results.filter(result => result.acquired);
  assert.equal(winners.length, 1);
  assert.equal(results.filter(result => result.status === 'active').length, 6);
  assert.throws(() => maintenanceLease('release', { path, token: 'x'.repeat(43) }), /Ownership token/);
  assert.equal(maintenanceLease('renew', { path, token: winners[0].token, ttlMs: 60_000 }).status, 'active');
  assert.equal(maintenanceLease('release', { path, token: winners[0].token }).released, true);
  assert.equal(maintenanceLease('status', { path }).status, 'unlocked');
}));
test('expired live owner is never replaced or killed', async () => fixture(async path => {
  const lease = maintenanceLease('acquire', { path, ownerPid: process.pid });
  await mutate(path, row => { row.expiresAt = Date.now() - 1; });
  const retry = maintenanceLease('acquire', { path, ownerPid: process.pid });
  assert.equal(retry.acquired, false); assert.equal(retry.status, 'expired-live');
  assert.equal(maintenanceLease('renew', { path, token: lease.token }).status, 'active');
  maintenanceLease('release', { path, token: lease.token });
}));
test('dead owners wait until expiry and then permit bounded stale recovery', async () => fixture(async path => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  try {
    maintenanceLease('acquire', { path, ownerPid: child.pid });
    const exited = once(child, 'exit'); child.kill(); await exited; // Only this test's disposable child is stopped.
    assert.equal(maintenanceLease('status', { path }).status, 'abandoned-waiting');
    assert.equal(maintenanceLease('acquire', { path, ownerPid: process.pid }).acquired, false);
    await mutate(path, row => { row.expiresAt = Date.now() - 1; });
    const replacement = maintenanceLease('acquire', { path, ownerPid: process.pid });
    assert.equal(replacement.acquired, true); assert.equal(replacement.reclaimedExpiredOwner, true);
    maintenanceLease('release', { path, token: replacement.token });
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
}));
test('PID reuse, malformed state and unknown hosts are handled conservatively', async () => fixture(async path => {
  maintenanceLease('acquire', { path, ownerPid: process.pid });
  await mutate(path, row => { row.expiresAt = Date.now() - 1; row.identity.startTicks = '0'; });
  const replacement = maintenanceLease('acquire', { path, ownerPid: process.pid });
  assert.equal(replacement.reclaimedExpiredOwner, true, 'A reused PID must not impersonate the recorded process');
  await mutate(path, row => { row.expiresAt = Date.now() - 1; row.identity.host = 'another-host.invalid'; });
  assert.equal(maintenanceLease('acquire', { path, ownerPid: process.pid }).status, 'unknown-host');
  await mutate(path, row => { row.identity.host = replacement.ownerHost; delete row.identity.startTicks; });
  assert.equal(maintenanceLease('acquire', { path, ownerPid: process.pid }).status, 'invalid-lease');
  await writeFile(path, '{');
  assert.equal(maintenanceLease('acquire', { path, ownerPid: process.pid }).status, 'invalid-lease');
}));
test('invalid owner PIDs and unbounded TTLs are rejected before acquiring', async () => fixture(async path => {
  assert.throws(() => maintenanceLease('acquire', { path, ownerPid: 0 }), /positive owner PID/);
  assert.throws(() => maintenanceLease('acquire', { path, ownerPid: process.pid, ttlMs: 7_200_001 }), /TTL/);
  assert.equal(maintenanceLease('status', { path }).status, 'unlocked');
}));
test('persistent holder writes a private token and releases on its own termination', async () => fixture(async path => {
  const tokenFile = `${path}.token`;
  const child = spawn(process.execPath, [resolve('scripts/maintenance-run-lock.mjs'), 'hold', '--path', path, '--token-file', tokenFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolveReady, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) resolveReady(JSON.parse(output.split('\n')[0])); });
    child.on('exit', code => { if (!output.includes('\n')) reject(new Error(`Holder exited before acquiring: ${code}`)); });
  });
  try {
    const acquired = await ready;
    assert.equal(acquired.acquired, true);
    assert.equal(acquired.token, undefined, 'Do not echo a token already written to its private file');
    const { stat } = await import('node:fs/promises');
    assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
    assert.equal(maintenanceLease('status', { path }).ownerPid, child.pid);
    assert.equal(maintenanceLease('acquire', { path, ownerPid: process.pid }).acquired, false);
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    assert.equal(maintenanceLease('status', { path }).status, 'unlocked');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
}));
