import test from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchTierPricing } from '../server/launch-tier-pricing.mjs';

function pricing(overrides = {}) {
  const calls = { pool:0, sol:0 };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createLaunchTierPricing({
    solanaCluster:'devnet', fundedTokenMint:'mint', fundedSwapPool:'pool', solanaRpcUrl:'http://127.0.0.1:1',
    readSolUsdQuote:async () => { calls.sol++; return { priceUsd:'150', fetchedAt:new Date().toISOString() }; },
    fetchVerifiedPoolSnapshot:async () => { calls.pool++; await gate; return { spotPriceSol:'0.00001', pool:'pool', slot:7 }; },
    ...overrides,
  });
  return { service, calls, release };
}

test('concurrent tier price requests share one pool read and then use the cache', async () => {
  const { service, calls, release } = pricing();
  const pending = [service.currentLaunchTierPricing(), service.currentLaunchTierPricing(), service.currentLaunchTierPricing()];
  release();
  const values = await Promise.all(pending);
  assert.equal(calls.pool, 1);
  assert.equal(calls.sol, 1);
  assert.ok(values.every(value => value === values[0]));
  assert.equal(values[0].tokenPriceUsd, 0.0015);
  await service.currentLaunchTierPricing();
  assert.equal(calls.pool, 1, 'a cached price is reused within 30 seconds');
});

test('a failed tier price read is not cached', async () => {
  let fail = true;
  const { service, calls, release } = pricing({
    readSolUsdQuote:async () => (fail ? null : { priceUsd:'150', fetchedAt:new Date().toISOString() }),
  });
  release();
  await assert.rejects(service.currentLaunchTierPricing(), /SOL\/USD quote/);
  fail = false;
  const value = await service.currentLaunchTierPricing();
  assert.equal(value.solUsd, 150);
  assert.equal(calls.pool, 2);
});
