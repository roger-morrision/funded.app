import test from 'node:test';
import assert from 'node:assert/strict';
import { pollXPostWorker } from '../scripts/run-x-post-worker.mjs';

function fixture(overrides = {}) {
  const calls = { prepare:0, dispatch:[], waits:[], reports:[], errors:[] };
  let stopped = false;
  const options = {
    config:{mode:'loop', intervalMs:60_000},
    prepare:async () => ({ verified:true, attempt:++calls.prepare }),
    dispatch:async adapters => { calls.dispatch.push(adapters); return {collected:0}; },
    shouldStop:() => stopped,
    wait:async ms => { calls.waits.push(ms); stopped = true; },
    report:value => calls.reports.push(value),
    blocked:error => calls.errors.push(error.message),
    ...overrides,
  };
  return { calls, options, stop:() => { stopped = true; }, run:() => pollXPostWorker(options) };
}

test('startup RPC failure stays blocked and retries at the configured interval before dispatch', async () => {
  const f = fixture();
  f.options.prepare = async () => {
    if (++f.calls.prepare === 1) throw new Error('429 max usage reached');
    return {verified:true, attempt:f.calls.prepare};
  };
  f.options.wait = async ms => { f.calls.waits.push(ms); if (f.calls.waits.length === 2) f.stop(); };
  await f.run();
  assert.deepEqual(f.calls.errors, ['429 max usage reached']);
  assert.deepEqual(f.calls.waits, [60_000, 60_000]);
  assert.deepEqual(f.calls.dispatch, [{verified:true, attempt:2}]);
  assert.equal(f.calls.reports.length, 1);
});

test('repeated failed verification never dispatches or reports a successful pass', async () => {
  const f = fixture({ prepare:async () => { throw new Error('Router not verified'); } });
  f.options.wait = async ms => { f.calls.waits.push(ms); if (f.calls.waits.length === 3) f.stop(); };
  await f.run();
  assert.equal(f.calls.errors.length, 3);
  assert.equal(f.calls.dispatch.length, 0);
  assert.equal(f.calls.reports.length, 0);
  assert.deepEqual(f.calls.waits, [60_000, 60_000, 60_000]);
});

test('once mode fails visibly without retrying or dispatching unverified adapters', async () => {
  const f = fixture({ config:{mode:'once',intervalMs:60_000}, prepare:async () => { throw new Error('Unavailable'); } });
  await assert.rejects(f.run(), /Unavailable/);
  assert.deepEqual(f.calls.errors, ['Unavailable']);
  assert.equal(f.calls.dispatch.length, 0);
  assert.equal(f.calls.waits.length, 0);
});

test('verification is refreshed each pass; an outage never reuses a previous authority', async () => {
  const f = fixture();
  f.options.prepare = async () => {
    if (++f.calls.prepare === 2) throw new Error('RPC unavailable');
    return {verified:true, attempt:f.calls.prepare};
  };
  f.options.wait = async ms => { f.calls.waits.push(ms); if (f.calls.waits.length === 3) f.stop(); };
  await f.run();
  assert.deepEqual(f.calls.dispatch.map(row => row.attempt), [1,3]);
  assert.equal(f.calls.errors.length, 1);
});

test('shutdown while verification is pending prevents a new publication cycle', async () => {
  const f = fixture();
  f.options.prepare = async () => { f.stop(); return {verified:true}; };
  await f.run();
  assert.equal(f.calls.dispatch.length, 0);
  assert.equal(f.calls.waits.length, 0);
  assert.equal(f.calls.errors.length, 0);
});

test('a failed dispatch waits before retry and repeats verification', async () => {
  const f = fixture();
  f.options.dispatch = async adapters => { f.calls.dispatch.push(adapters); throw new Error('Account check unavailable'); };
  f.options.wait = async ms => { f.calls.waits.push(ms); if (f.calls.waits.length === 2) f.stop(); };
  await f.run();
  assert.equal(f.calls.prepare, 2);
  assert.equal(f.calls.errors.length, 2);
  assert.deepEqual(f.calls.waits, [60_000,60_000]);
});

test('successful once mode reports once and never enters a polling wait', async () => {
  const f = fixture({config:{mode:'once',intervalMs:60_000}});
  await f.run();
  assert.equal(f.calls.prepare, 1);
  assert.equal(f.calls.dispatch.length, 1);
  assert.equal(f.calls.reports.length, 1);
  assert.equal(f.calls.waits.length, 0);
});

test('a stop requested before startup does not verify or dispatch', async () => {
  const f = fixture(); f.stop(); await f.run();
  assert.equal(f.calls.prepare, 0);
  assert.equal(f.calls.dispatch.length, 0);
  assert.equal(f.calls.waits.length, 0);
});
