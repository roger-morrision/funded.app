import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolanaRpcProxy } from '../server/rpc-proxy.mjs';
import { createMarketProviders, normalizePumpToken, normalizeBirdeyeToken } from '../server/market-providers.mjs';
import { createLaunchTierPricing } from '../server/launch-tier-pricing.mjs';
import { createSettlementRewards, solToLamports } from '../server/settlement-rewards.mjs';

const reply = (result, status = 200) => ({ ok: status === 200, status, json: async () => result });
function rpcFixture(overrides = {}) {
  const calls = [], charges = [];
  const { proxySolanaRpc } = createSolanaRpcProxy({
    rpcMethods: new Set(['getBalance', 'getSlot', 'getProgramAccounts', 'sendTransaction']),
    solanaRpcUrl: 'http://unused.invalid',
    body: async req => structuredClone(req.body),
    authorized: () => false, clientKey: () => 'fixture',
    json: (_res, status, body) => ({ status, body }),
    store: { chargeRpcRate: async (...args) => { charges.push(args); return true; } },
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body); calls.push(request);
      return reply({ jsonrpc: '2.0', id: request.id, result: calls.length });
    },
    ...overrides,
  });
  const request = (method = 'getSlot', id = 1, params = [], options = {}) => proxySolanaRpc({
    url: '/api/solana/rpc', headers: {}, body: { jsonrpc: '2.0', method, params, id }, ...options,
  }, {});
  return { request, calls, charges };
}

test('RPC caches reads per instance, preserves caller IDs, and never caches writes', async () => {
  const first = rpcFixture(), second = rpcFixture();
  await first.request();
  assert.equal((await first.request('getSlot', 'next')).body.id, 'next');
  assert.equal(first.calls.length, 1);
  await second.request();
  assert.equal(second.calls.length, 1, 'Instances must not share cached data');
  await first.request('sendTransaction', 3, ['synthetic']);
  await first.request('sendTransaction', 4, ['synthetic']);
  assert.equal(first.calls.length, 3);
  assert.equal(first.charges.filter(row => row[0] === 'rpc-write:fixture').length, 2);
});

test('RPC origin, privilege, and rate gates reject before any upstream call', async () => {
  const api = rpcFixture();
  assert.equal((await api.request('getSlot', 1, [], { headers: { origin: 'invalid-origin' } })).status, 403);
  assert.equal((await api.request('getProgramAccounts')).status, 401);
  assert.equal(api.calls.length, 0);
  const limited = rpcFixture({ store: { chargeRpcRate: async () => false } });
  assert.equal((await limited.request()).status, 429);
  assert.equal(limited.calls.length, 0);
  await api.request('getBalance', 2, ['wallet'], { url: '/api/solana/rpc?purpose=trade-preview' });
  assert.deepEqual(api.charges[0].slice(0, 3), ['rpc-preview:fixture', 1, 40]);
});

test('RPC concurrency slots are released after upstream failure', async () => {
  let started = 0;
  const pending = [];
  const api = rpcFixture({ fetch: () => { started++; return new Promise((_resolve, reject) => pending.push(reject)); } });
  const requests = Array.from({ length: 12 }, (_, i) => api.request('getSlot', i));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 12);
  assert.equal((await api.request()).status, 429);
  pending.splice(0).forEach(reject => reject(new Error('Synthetic outage')));
  assert.ok((await Promise.all(requests)).every(result => result.status === 502));
  const retry = api.request();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 13);
  pending[0](new Error('Synthetic outage'));
  assert.equal((await retry).status, 502);
});

test('RPC error responses are not cached and recovered reads can succeed', async () => {
  let count = 0;
  const api = rpcFixture({ fetch: async () => ++count === 1
    ? reply({ error: { code: -32000 } }) : reply({ result: 42 }) });
  assert.ok((await api.request()).body.error);
  assert.equal((await api.request()).body.result, 42);
  assert.equal(count, 2);
});

function providers(overrides = {}) {
  return createMarketProviders({ birdeyeApiKey: 'synthetic-key', birdeyeBaseUrl: 'https://bird.invalid',
    birdeyeChain: 'solana', birdeyeTimeoutMs: 1000, pumpApiUrl: 'https://pump.invalid', ...overrides });
}

test('Market providers keep credentials scoped and skip unconfigured Birdeye requests', async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return reply({ success: true, data: [] }); };
  assert.deepEqual(await providers({ birdeyeApiKey: '', fetch }).fetchBirdeye('/tokens'), { configured: false, data: null });
  assert.equal(calls.length, 0);
  const api = providers({ fetch });
  await api.fetchBirdeye('/tokens', { search: 'a&b' });
  await api.fetchPump('/coins');
  assert.equal(new URL(calls[0].url).searchParams.get('search'), 'a&b');
  assert.equal(calls[0].options.headers['X-API-KEY'], 'synthetic-key');
  assert.equal(calls[1].options.headers['X-API-KEY'], undefined);
});

test('Market provider errors remain errors and supported Pump envelopes remain readable', async () => {
  await assert.rejects(providers({ fetch: async () => reply({ success: false, message: 'rate limited' }) }).fetchBirdeye('/tokens'), /rate limited/);
  await assert.rejects(providers({ fetch: async () => reply({}, 503) }).fetchPump('/coins'), /503/);
  for (const payload of [[{ mint: 'coin' }], { coins: [{ mint: 'coin' }] }, { data: [{ mint: 'coin' }] }]) {
    assert.deepEqual(await providers({ fetch: async () => reply(payload) }).fetchPump('/coins'), [{ mint: 'coin' }]);
  }
  assert.equal(normalizePumpToken({}), null);
  assert.equal(normalizeBirdeyeToken({}), null);
  assert.equal(normalizePumpToken({ mint: ' coin ', usd_market_cap: 'invalid' }).marketCapUsd, null);
  assert.equal(normalizeBirdeyeToken({ address: ' coin ', market_cap: '150' }).marketCapUsd, 150);
});

function pricing(overrides = {}) {
  return createLaunchTierPricing({ solanaCluster: 'devnet', fundedTokenMint: 'fixture-mint', fundedSwapPool: 'fixture-pool',
    solanaRpcUrl: 'http://unused.invalid', readSolUsdQuote: async () => ({ priceUsd: 100, fetchedAt: new Date().toISOString() }),
    fetchVerifiedPoolSnapshot: async () => ({ pool: 'fixture-pool', slot: 123, spotPriceSol: 0.01 }), ...overrides });
}

test('Launch pricing caches verified quotes per instance and refreshes after expiry', async t => {
  let now = Date.now(), reads = 0;
  t.mock.method(Date, 'now', () => now);
  const options = { readSolUsdQuote: async () => ({ priceUsd: 100, fetchedAt: new Date(now).toISOString() }),
    fetchVerifiedPoolSnapshot: async () => { reads++; return { pool: 'pool', slot: reads, spotPriceSol: 0.01 }; } };
  const first = pricing(options), second = pricing(options);
  const quote = await first.currentLaunchTierPricing();
  assert.deepEqual(quote.amounts, { pro: 100, premier: 200 });
  assert.equal(await first.currentLaunchTierPricing(), quote);
  assert.equal(reads, 1);
  await second.currentLaunchTierPricing();
  assert.equal(reads, 2);
  now += 30_001;
  assert.notEqual(await first.currentLaunchTierPricing(), quote);
  assert.equal(reads, 3);
});

test('Launch pricing rejects unsupported networks and stale quotes before caching', async () => {
  await assert.rejects(pricing({ solanaCluster: 'mainnet-beta', readSolUsdQuote: () => assert.fail('Unexpected provider read') }).currentLaunchTierPricing(), /Devnet/);
  let fresh = false;
  const api = pricing({ readSolUsdQuote: async () => ({ priceUsd: 100, fetchedAt: new Date(fresh ? Date.now() : 0).toISOString() }) });
  await assert.rejects(api.currentLaunchTierPricing(), /fresh SOL/);
  fresh = true;
  assert.equal((await api.currentLaunchTierPricing()).tokenPriceUsd, 1);
});

function rewardFixture() {
  let rewards = {};
  const state = { launches: { mint: { mint: 'mint', creatorWallet: 'creator', onchainVerified: true } },
    collections: { receipt: { mint: 'mint', status: 'collected', attribution: 'mint-verified' } },
    obligations: { obligation: { id: 'obligation', mint: 'mint', claimSignature: 'receipt' } } };
  const settlement = { claimSignature: 'receipt', creatorDestinations: { creatorWallet: 0.1, holderAirdrop: 0.2, solClaim: 0.3 }, fundedApp: { operations: 0, community: 0.4 } };
  const api = createSettlementRewards({ store: { read: async () => structuredClone(state) }, automaticRewardStore: {
    transaction: async callback => { const next = structuredClone(rewards); const result = await callback(next); rewards = next; return result; },
  } });
  return { ...api, state, settlement, snapshot: () => structuredClone(rewards) };
}

test('Settlement rewards require verified evidence and reject conflicting replay atomically', async () => {
  const api = rewardFixture();
  api.state.collections.receipt.attribution = 'unknown';
  await assert.rejects(api.queueAutomaticSettlementRewards(api.settlement), /verified collection/);
  assert.deepEqual(api.snapshot(), {});
  api.state.collections.receipt.attribution = 'mint-verified';
  await api.queueAutomaticSettlementRewards(api.settlement);
  const before = api.snapshot();
  assert.equal(before.fundingRequests['receipt:creator'].amount, '100000000');
  await api.queueAutomaticSettlementRewards(api.settlement);
  assert.deepEqual(api.snapshot(), before);
  await assert.rejects(api.queueAutomaticSettlementRewards({ ...api.settlement,
    creatorDestinations: { ...api.settlement.creatorDestinations, holderAirdrop: 0.5 } }), /immutable settlement/);
  assert.deepEqual(api.snapshot(), before);
});

test('X reward enrollment requires matching attestation and cannot replace the recipient', async () => {
  const api = rewardFixture();
  await api.queueAutomaticSettlementRewards(api.settlement);
  const claim = { publicKey: 'wallet', xUserId: 'account', obligationId: 'obligation', xAttestation: { subject: 'different' } };
  await api.enrollAutomaticXReward(claim);
  assert.equal(api.snapshot().fundingRequests['receipt:x'].status, 'awaiting-verified-recipient');
  claim.xAttestation.subject = 'account';
  assert.equal(await api.enrollAutomaticXReward(claim), 'pending');
  await api.enrollAutomaticXReward({ ...claim, publicKey: 'other-wallet' });
  assert.equal(api.snapshot().fundingRequests['receipt:x'].recipient, 'wallet');
});

test('Holder registration is idempotent and invalid reward amounts cannot be queued', async () => {
  const api = rewardFixture();
  const launch = { mint: 'mint', feeDistribution: { creatorDirected: { shares: { holderAirdropPercent: 0 } } } };
  await api.registerAutomaticLaunch(launch);
  assert.deepEqual(api.snapshot(), {});
  launch.feeDistribution.creatorDirected.shares.holderAirdropPercent = 10;
  await api.registerAutomaticLaunch(launch);
  const before = api.snapshot();
  await api.registerAutomaticLaunch(launch);
  assert.deepEqual(api.snapshot(), before);
  for (const amount of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => solToLamports(amount), /valid lamports/);
  assert.equal(solToLamports(0.000000001), '1');
});
