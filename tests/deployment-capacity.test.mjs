import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { assessCapacity, CAPACITY_THRESHOLDS, containerCapacity, deploymentCapacity, workspaceCapacity } from '../scripts/check-deployment-capacity.mjs';

const exact = phase => ({ freeBytes: String(CAPACITY_THRESHOLDS[phase].freeBytes), freeInodes: String(CAPACITY_THRESHOLDS[phase].freeInodes) });
test('capacity requires both byte and inode reserves with exact phase boundaries', () => {
  for (const phase of ['build', 'switch']) {
    const sample = exact(phase);
    assert.equal(assessCapacity(sample, phase).ready, true);
    assert.deepEqual(assessCapacity({ ...sample, freeBytes: String(BigInt(sample.freeBytes) - 1n) }, phase).reasons, ['insufficient-free-bytes']);
    assert.deepEqual(assessCapacity({ ...sample, freeInodes: String(BigInt(sample.freeInodes) - 1n) }, phase).reasons, ['insufficient-free-inodes']);
    assert.equal(assessCapacity({ freeBytes: '0', freeInodes: '0' }, phase).ready, false);
  }
  assert.equal(assessCapacity(exact('switch'), 'build').ready, false);
  assert.equal(assessCapacity({ freeBytes: '9007199254740993', freeInodes: '10000' }).ready, true);
});
test('missing, negative or malformed readings fail closed instead of using optimistic defaults', () => {
  for (const value of [null, {}, { freeBytes: '-1', freeInodes: '10000' }, { freeBytes: 'Infinity', freeInodes: '10000' }, { freeBytes: 1e12, freeInodes: '10000' }]) {
    assert.deepEqual(assessCapacity(value), { ready: false, reason: 'capacity-unavailable' });
  }
});
test('one unavailable or low filesystem blocks an otherwise healthy deployment check', async () => {
  const options = { container: 'existing-app', workspace: tmpdir() };
  const good = () => exact('build');
  const unavailable = () => { throw new Error('Sensitive daemon detail must not be emitted'); };
  for (const adapters of [{ readWorkspace: good, readContainer: unavailable }, { readWorkspace: unavailable, readContainer: good },
    { readWorkspace: good, readContainer: () => ({ freeBytes: '0', freeInodes: '0' }) }]) {
    const report = await deploymentCapacity(options, adapters);
    assert.equal(report.ready, false); assert.equal(report.readOnly, true);
    assert.equal(report.samples.filter(sample => sample.ready).length, 1);
    assert.doesNotMatch(JSON.stringify(report), /Sensitive/);
  }
  assert.equal((await deploymentCapacity(options, { readWorkspace: good, readContainer: good })).ready, true);
});
test('container capacity reads only the explicit local daemon and preserves registry/proxy configuration', () => {
  let calls = 0;
  const sample = containerCapacity('existing-app', (command, args, options) => {
    calls++; assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 5), ['--host=unix:///var/run/docker.sock', 'exec', 'existing-app', 'node', '-e']);
    assert.match(args[5], /statfsSync/); assert.doesNotMatch(args[5], /write|unlink|rm\(/);
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) assert.equal(options.env[key], undefined);
    assert.equal(options.env.DOCKER_CONFIG, process.env.DOCKER_CONFIG);
    assert.equal(options.env.HTTPS_PROXY, process.env.HTTPS_PROXY);
    return JSON.stringify(exact('build'));
  });
  assert.equal(calls, 1); assert.equal(assessCapacity(sample).ready, true);
  assert.throws(() => containerCapacity('--privileged', () => assert.fail('No Docker call allowed')), /existing application/);
  assert.throws(() => containerCapacity('app;echo secret', () => assert.fail('No shell input allowed')), /existing application/);
});
test('actual workspace statfs yields exact decimal readings and reports nonexistent paths', async () => {
  const result = await workspaceCapacity(tmpdir());
  assert.match(result.freeBytes, /^\d+$/); assert.match(result.freeInodes, /^\d+$/);
  await assert.rejects(workspaceCapacity('/funded-capacity-nonexistent-directory'), { code: 'ENOENT' });
  await assert.rejects(deploymentCapacity({ container: 'app', phase: 'unknown' }), /Phase/);
});
