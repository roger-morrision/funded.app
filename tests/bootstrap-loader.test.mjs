import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBootstrapModules } from '../bootstrap-loader.js';

test('an optional module failure preserves initialization order and later workspace features', async () => {
  const calls = [], notices = [];
  const failures = await loadBootstrapModules([
    { name: 'core', required: true, load: async () => calls.push('core') },
    { name: 'optional', load: async () => { calls.push('optional'); throw new Error('offline'); } },
    { name: 'workspace', load: async () => calls.push('workspace') },
    { name: 'status', load: async () => calls.push('status') },
  ], failure => notices.push(failure.name));
  assert.deepEqual(calls, ['core', 'optional', 'workspace', 'status']);
  assert.deepEqual(notices, ['optional']);
  assert.equal(failures.length, 1);
});
test('a failed required core prevents dependent modules from starting', async () => {
  const calls = [];
  const failures = await loadBootstrapModules([
    { name: 'core', required: true, load: async () => { throw new Error('failed'); } },
    { name: 'wallet', load: async () => calls.push('wallet') },
  ]);
  assert.deepEqual(calls, []);
  assert.equal(failures[0].required, true);
});
