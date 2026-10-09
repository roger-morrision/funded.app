import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryRoutes } from '../server/routes/discovery.mjs';
import { createLaunchQuoteRoutes } from '../server/routes/launch-quotes.mjs';
import { createRewardStatusRoutes } from '../server/routes/reward-status.mjs';

const payer = '11111111111111111111111111111111';
function fixture(factory, dependencies = {}) {
  const responses = [];
  const handler = factory({ body: async req => req.input, clientKey: () => 'fixture',
    solanaCluster: 'devnet', ...dependencies,
    respond: (_res, status, data) => responses.push({ status, data }) });
  return { responses, request: (path, input = {}, method = 'GET', origin = 'https://funded.vip') =>
    handler({ method, input, headers: { origin, host: 'funded.vip' }, socket: { encrypted: true } }, {}, new URL(path, 'https://funded.vip')) };
}

test('extracted routes leave unmatched requests untouched', async () => {
  for (const factory of [createDiscoveryRoutes, createLaunchQuoteRoutes, createRewardStatusRoutes]) {
    const f = fixture(factory);
    assert.equal(await f.request('/api/unmatched'), false);
    assert.deepEqual(f.responses, []);
  }
});

test('discovery bounds concurrent verification and releases slots after failed proof', async () => {
  const launches = Array.from({ length: 5 }, (_, i) => ({ mint: `coin-${i}`, chain: 'solana', cluster: 'devnet' }));
  const completions = [];
  let updates = 0;
  const f = fixture(createDiscoveryRoutes, {
    Connection: class {}, solanaRpcUrl: 'http://unused.invalid',
    store: { readLaunches: async () => launches, chargeRpcRate: async () => true,
      read: async () => ({}), update: async fn => { updates++; return fn({ launches: {} }); } },
    verifyPumpLaunch: () => new Promise((resolve, reject) => completions.push({ resolve, reject })),
  });
  const first = f.request('/api/pump/explore');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completions.length, 4);
  await f.request('/api/pump/explore');
  assert.equal(completions.length, 4, 'Concurrent requests share the four-proof cap');
  assert.deepEqual(f.responses[0].data.items, []);
  for (const completion of completions) completion.reject(new Error('Unverified fixture'));
  await first;
  assert.equal(updates, 0, 'Failed proofs must not enter the launch registry');
  const retry = f.request('/api/pump/explore');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completions.length, 8, 'Failures release the verification slots');
  for (const completion of completions.slice(4)) completion.resolve({ onchainVerified: true });
  await retry;
  assert.equal(updates, 4);
  assert.equal(f.responses.at(-1).data.items.length, 4);
});

test('launch quotes reject origin, rate limits and invalid input before reading prices', async () => {
  let prices = 0;
  let allowed = true;
  const f = fixture(createLaunchQuoteRoutes, {
    store: { chargeRpcRate: async () => allowed },
    currentLaunchTierPricing: async () => { prices++; throw new Error('Unexpected price read'); },
  });
  await f.request('/api/launch-tier-quote', {}, 'POST', 'invalid-origin');
  assert.equal(f.responses.at(-1).status, 403);
  const origin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*' ? process.env.CORS_ORIGIN : 'https://funded.vip';
  allowed = false;
  await f.request('/api/launch-tier-quote', {}, 'POST', origin);
  assert.equal(f.responses.at(-1).status, 429);
  allowed = true;
  await f.request('/api/launch-tier-quote', { tier: 'unknown' }, 'POST', origin);
  assert.equal(f.responses.at(-1).status, 400);
  await f.request('/api/launch-tier-quote', { tier: 'pro', payer: 'invalid' }, 'POST', origin);
  assert.equal(f.responses.at(-1).status, 400);
  assert.equal(prices, 0);
});

test('launch quote binds payer, price and expiry, retains recent quotes and prunes old ones', async () => {
  const state = { launchTierQuotes: { old: { expiresAt: '2000-01-01' }, recent: { expiresAt: new Date().toISOString() } } };
  const f = fixture(createLaunchQuoteRoutes, {
    store: { chargeRpcRate: async () => true, update: async fn => fn(state) },
    id: () => 'quote-fixture', fundedTokenMint: 'funded-mint',
    currentLaunchTierPricing: async () => ({ amounts: { pro: 100 }, tokenPriceUsd: 1, pool: 'pool', slot: 42, source: 'fixture' }),
  });
  const origin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*' ? process.env.CORS_ORIGIN : 'https://funded.vip';
  assert.equal(await f.request('/api/launch-tier-quote', { tier: 'pro', payer }, 'POST', origin), true);
  const { status, data } = f.responses[0];
  assert.equal(status, 201);
  assert.equal(data.payer, payer);
  assert.equal(data.amountTokens, 100);
  assert.equal(data.fundedMint, 'funded-mint');
  assert.equal(Date.parse(data.expiresAt) - Date.parse(data.createdAt), 600_000);
  assert.equal(state.launchTierQuotes[data.id], data);
  assert.equal(state.launchTierQuotes.old, undefined);
  assert.ok(state.launchTierQuotes.recent);
});

test('price provider failures remain unavailable and never persist a quote', async () => {
  const f = fixture(createLaunchQuoteRoutes, {
    store: { chargeRpcRate: async () => true, update: () => assert.fail('Must not store an unavailable quote') },
    currentLaunchTierPricing: async () => { throw new Error('Quote unavailable'); },
  });
  await f.request('/api/launch-tier-quote');
  assert.equal(f.responses[0].status, 503);
  const origin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*' ? process.env.CORS_ORIGIN : 'https://funded.vip';
  await f.request('/api/launch-tier-quote', { tier: 'pro', payer }, 'POST', origin);
  assert.equal(f.responses[1].status, 503);
});

test('buyback status exposes only finalized verified receipts and strips transaction payloads', async () => {
  const f = fixture(createRewardStatusRoutes, { store: { read: async () => ({ buybackOrders: {
    paid: { id: 'paid', status: 'finalized', refundVerified: true, signedTransaction: 'private', refundTransaction: 'private' },
    pending: { id: 'pending', status: 'submitted', refundVerified: true },
    unverified: { id: 'unverified', status: 'finalized', refundVerified: false },
  } }) } });
  await f.request('/api/buyback/status');
  assert.deepEqual(f.responses[0].data.receipts, [{ id: 'paid', status: 'finalized', refundVerified: true }]);
  assert.equal(f.responses[0].data.mainnetReady, false);
});

test('reward experience checks rate and address validity before ledger reads', async () => {
  let allowed = false;
  const f = fixture(createRewardStatusRoutes, { store: {
    chargeRpcRate: async () => allowed,
    read: () => assert.fail('Rejected queries must not read reward data'),
  } });
  await f.request('/api/rewards/experience');
  assert.equal(f.responses[0].status, 429);
  allowed = true;
  await f.request('/api/rewards/experience?wallet=invalid');
  assert.equal(f.responses[1].status, 400);
});
