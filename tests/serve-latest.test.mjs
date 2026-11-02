import test from 'node:test';
import assert from 'node:assert/strict';
import { serveLatest } from '../server/payment-history.mjs';

test('the latest result is served at once while one background rebuild replaces it', async () => {
  let time = 0, builds = 0, release;
  const read = serveLatest(() => new Promise(resolve => { builds++; release = resolve; }), { refreshAfterMs: 30_000, now: () => time });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const first = read(); await tick(); release('v1'); assert.equal(await first, 'v1');
  time = 40_000;
  assert.equal(await read(), 'v1', 'stale result returns without waiting');
  assert.equal(await read(), 'v1');
  await tick();
  assert.equal(builds, 2, 'only one background rebuild runs');
  release('v2'); await tick();
  assert.equal(await read(), 'v2');
});

test('a failed rebuild keeps the previous result', async () => {
  let time = 0, fail = false;
  const read = serveLatest(async () => { if (fail) throw new Error('rpc down'); return 'ok'; }, { refreshAfterMs: 10, now: () => time });
  assert.equal(await read(), 'ok');
  fail = true; time = 100;
  assert.equal(await read(), 'ok');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await read(), 'ok');
});
