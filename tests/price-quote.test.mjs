import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolUsdQuoteReader } from '../server/price-quote.mjs';

test('concurrent refreshes share one upstream request and cache it', async () => {
  let calls = 0;
  const read = createSolUsdQuoteReader({ fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ solana: { usd: 150 } }) }; } });
  const values = await Promise.all(Array.from({ length: 30 }, () => read()));
  assert.equal(calls, 1);
  assert.equal(values.every(value => value.priceUsd === 150), true);
  await read(); assert.equal(calls, 1);
});
test('outages back off and expired quotes cannot authorize checkout', async () => {
  let clock = 0, calls = 0;
  const read = createSolUsdQuoteReader({ now: () => clock, ttlMs: 100, retryMs: 50, fetchImpl: async () => { calls++; if (calls > 1) throw new Error('offline'); return { ok: true, json: async () => ({ solana: { usd: 150 } }) }; } });
  assert.equal((await read()).priceUsd, 150);
  clock = 101; assert.equal(await read(), null);
  assert.equal(await read(), null); assert.equal(calls, 2);
  clock = 152; await read(); assert.equal(calls, 3);
});
test('operator quotes bypass upstream and malformed quotes fail closed', async () => {
  const read = createSolUsdQuoteReader({ fetchImpl: async () => ({ ok: true, json: async () => ({ solana: { usd: -1 } }) }) });
  assert.equal((await read('160')).source, 'server-config');
  assert.equal(await read(), null);
});
