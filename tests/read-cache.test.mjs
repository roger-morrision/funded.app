import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadCache } from '../server/read-cache.mjs';

function clock(start = 1_000_000) { let time = start; return { now: () => time, advance: ms => { time += ms; } }; }
const flush = () => new Promise(resolve => setImmediate(resolve));

test('default cache shares in-flight reads and reloads after the TTL', async () => {
  const c = clock(); let calls = 0;
  const cache = createReadCache({ ttlMs: 100, now: c.now });
  const loader = async () => ++calls;
  assert.deepEqual(await Promise.all([cache('k', loader), cache('k', loader)]), [1, 1]);
  c.advance(50); assert.equal(await cache('k', loader), 1);
  c.advance(60); assert.equal(await cache('k', loader), 2, 'without staleMs an expired value is reloaded before returning');
});

test('stale window serves the last value while exactly one refresh runs', async () => {
  const c = clock(); let calls = 0; let release;
  const cache = createReadCache({ ttlMs: 100, staleMs: 1000, now: c.now });
  assert.equal(await cache('k', async () => ++calls), 1);
  c.advance(150);
  const slow = () => new Promise(resolve => { calls++; release = () => resolve(calls); });
  assert.equal(await cache('k', slow), 1, 'expired value returned immediately');
  assert.equal(await cache('k', slow), 1, 'second caller does not start another refresh');
  assert.equal(calls, 2);
  release(); await flush();
  assert.equal(await cache('k', slow), 2, 'refreshed value is used once it arrives');
});

test('a failed refresh keeps the last value inside the stale window, then fails after it', async () => {
  const c = clock(); let fail = false;
  const cache = createReadCache({ ttlMs: 100, staleMs: 1000, now: c.now });
  const loader = async () => { if (fail) throw new Error('rpc down'); return 'fresh'; };
  assert.equal(await cache('k', loader), 'fresh');
  fail = true; c.advance(150);
  assert.equal(await cache('k', loader), 'fresh');
  await flush();
  assert.equal(await cache('k', loader), 'fresh', 'still served after the failed refresh');
  c.advance(2000);
  await assert.rejects(cache('k', loader), /rpc down/, 'beyond ttl + staleMs the caller waits for a real read');
});
