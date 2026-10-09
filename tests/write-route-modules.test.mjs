import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { createKeeperCollectionRoutes } from '../server/routes/keeper-collection.mjs';
import { createLaunchRegistrationRoutes } from '../server/routes/launch-registration.mjs';
import { createListingPaymentsRoutes } from '../server/routes/listing-payments.mjs';
import { createSettlementRoutes } from '../server/routes/settlement.mjs';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';

const mint = 'So11111111111111111111111111111111111111112';
const walletKey = value => new PublicKey(value).toBase58();
function fixture(create, dependencies = {}) {
  const responses = [];
  const handle = create({ solanaCluster: 'devnet', walletKey, body: async req => req.input,
    ...dependencies, respond: (_res, status, data) => responses.push({ status, data }) });
  return { responses, request: (path, input = {}, method = 'POST') =>
    handle({ method, input }, {}, new URL(path, 'https://funded.vip')) };
}

test('write route families leave unrelated requests to the shared dispatcher', async () => {
  for (const create of [createKeeperCollectionRoutes, createLaunchRegistrationRoutes,
    createListingPaymentsRoutes, createSettlementRoutes]) {
    const f = fixture(create);
    assert.equal(await f.request('/api/health', {}, 'GET'), false);
    assert.equal(await f.request('/api/launches', {}, 'OPTIONS'), false);
    assert.deepEqual(f.responses, []);
  }
});

test('keeper authorization denials terminate dispatch before reading or collecting', async () => {
  let denied = 0;
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized: () => { denied++; return false; },
    body: () => assert.fail('Unauthorized body read'),
    store: { read: () => assert.fail('Unauthorized store read') },
    collectPumpCreatorFees: () => assert.fail('Unauthorized collection'),
  });
  for (const [path, method] of [['indexer/sync', 'POST'], ['keeper/collection-candidates', 'GET'],
    ['keeper/collect', 'POST'], ['keeper/reconcile-wrapped-sol', 'POST']]) {
    assert.equal(await f.request(`/api/${path}`, {}, method), true);
  }
  assert.equal(denied, 4);
  assert.deepEqual(f.responses, [], 'The authorization helper already sent the response');
});

test('failed collection keeps its reconciliation lock and blocks replay', async () => {
  const state = { alerts: {}, collections: {} };
  let collections = 0;
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized: () => true, store: { update: async fn => fn(state) },
    collectPumpCreatorFees: async () => { collections++; throw Error('RPC outcome uncertain'); },
  });
  await assert.rejects(f.request('/api/keeper/collect', { mint }), /RPC outcome uncertain/);
  assert.equal(state.alerts[`fee-collect:${mint}`].status, 'review-required');
  assert.equal(await f.request('/api/keeper/collect', { mint }), true);
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(collections, 1);
});

test('launch registration rejects unsupported networks and missing router or promotion proof', async () => {
  const disabled = fixture(createLaunchRegistrationRoutes, { solanaCluster: 'mainnet-beta',
    body: () => assert.fail('Disabled launch must not be read') });
  await disabled.request('/api/launches');
  assert.equal(disabled.responses[0].status, 403);
  const f = fixture(createLaunchRegistrationRoutes, { fundedTokenMint: mint,
    store: { readLaunch: async () => null, read: async () => ({}) } });
  await f.request('/api/launches', { mint, chain: 'ethereum', cluster: 'devnet' });
  const input = { mint, creatorWallet: mint, chain: 'solana', cluster: 'devnet',
    communityAllocation: 3, pumpFeeRoute: { router: mint },
    feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 80 }) };
  await f.request('/api/launches', input);
  await f.request('/api/launches', { ...input, pumpFeeRoute: { router: mint, scope: 'per-mint-v2' },
    creatorLaunchBurn: { tier: 'pro', fundedMint: mint, amountTokens: 100_000, quoteId: 'missing' } });
  assert.deepEqual(f.responses.map(row => row.status), [400, 409, 409]);
  assert.match(f.responses[1].data.error, /mint-specific fee router/);
  assert.match(f.responses[2].data.error, /saved.*launch quote/);
});

test('burn and listing receipt replay preserves attribution and never repeats verification', async () => {
  const signature = '1'.repeat(64);
  const burn = { wallet: mint, projectMint: null, signature };
  const listing = { wallet: mint, signature, mint };
  const f = fixture(createListingPaymentsRoutes, { fundedTokenMint: mint,
    store: { read: async () => ({ burnReceipts: { [signature]: burn }, listings: { [mint]: listing } }),
      update: () => assert.fail('Receipt replay must not write') } });
  await f.request('/api/burn-receipts', { wallet: mint, signature });
  await f.request('/api/burn-receipts', { wallet: mint, signature, projectMint: mint });
  await f.request('/api/listings', { wallet: mint, signature, mint });
  await f.request('/api/listings', { wallet: mint, signature: '2'.repeat(64), mint });
  assert.deepEqual(f.responses.map(row => row.status), [200, 409, 200, 409]);
  assert.equal(f.responses[0].data, burn);
  assert.equal(f.responses[2].data, listing);
});

test('settlements use stored fee evidence, survive queue failure, and replay the same allocation', async () => {
  const signature = 'write-route-settlement';
  const state = { settlements: {}, collections: { [signature]: {
    signature, status: 'collected', attribution: 'mint-verified', cluster: 'devnet', mint,
    collectedLamports: '1000000000', recordedAt: '2026-10-09T00:00:00Z',
  } }, launches: { [mint]: { onchainVerified: true, cluster: 'devnet', creatorWallet: mint,
    feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 80 }) } } };
  const queued = [];
  const f = fixture(createSettlementRoutes, { store: { update: async fn => fn(state) },
    referralUplineForWallet: () => [], queueAutomaticSettlementRewards: async value => {
      queued.push(value); if (queued.length === 1) throw Error('Queue unavailable');
    } });
  await f.request('/api/settlements/claims', { claimSignature: signature, grossCreatorFees: 999999 });
  const allocation = state.settlements[signature];
  assert.equal(allocation.grossCreatorFees, 1);
  assert.equal(allocation.creatorDestinations.creatorWallet, 0.8);
  assert.equal(f.responses[0].data.automaticRewards.status, 'queue-failed');
  await f.request('/api/settlements/claims', { claimSignature: signature });
  assert.equal(state.settlements[signature], allocation);
  assert.deepEqual(queued, [allocation, allocation]);
  assert.equal(f.responses[1].data.automaticRewards.status, 'queued');
});

test('settlements reject missing, zero, or wrong-network collections without queueing', async () => {
  for (const collection of [undefined, { collectedLamports: 0, cluster: 'devnet' },
    { collectedLamports: 100, cluster: 'mainnet-beta' }]) {
    const state = { settlements: {}, collections: collection ? { invalid: {
      signature: 'invalid', status: 'collected', attribution: 'mint-verified', mint, ...collection,
    } } : {} };
    const f = fixture(createSettlementRoutes, { store: { update: async fn => fn(state) },
      queueAutomaticSettlementRewards: () => assert.fail('Invalid settlement queued') });
    await assert.rejects(f.request('/api/settlements/claims', { claimSignature: 'invalid' }), /positive, mint-verified/);
    assert.deepEqual(state.settlements, {});
  }
});
