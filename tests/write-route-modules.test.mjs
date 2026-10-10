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

test('listing quote binds $200 token amount to mint and payer before any burn', async () => {
  const state = { listings:{}, listingQuotes:{} };
  const responses = [];
  const handle = createListingPaymentsRoutes({ solanaCluster:'devnet', fundedTokenMint:mint,
    body:async req => req.input, walletKey, clientKey:() => 'fixture', id:() => 'listing_1000_0123456789abcdef',
    readFundedDecimals:async () => 6,
    currentLaunchTierPricing:async () => ({ tokenPriceUsd:0.03, pool:mint, slot:123, source:'verified-pump-swap-pool' }),
    store:{ chargeRpcRate:async () => true, read:async () => state, update:async fn => fn(state) },
    listingBurnAlreadyUsed:() => false,
    respond:(_res, status, data) => responses.push({ status, data }) });
  const request = (path, input) => handle({ method:'POST', input,
    headers:{ origin:'https://funded.vip', host:'funded.vip' }, socket:{ encrypted:true } }, {}, new URL(path, 'https://funded.vip'));
  await request('/api/listings/quote', { mint, payer:mint });
  assert.equal(responses[0].status, 201);
  assert.equal(responses[0].data.usd, 200);
  assert.equal(responses[0].data.amountTokens, 6_666.666667);
  assert.equal(responses[0].data.amountBaseUnits, '6666666667');
  assert.equal(state.listingQuotes[responses[0].data.id].payer, mint);
  await request('/api/listings', { mint, wallet:mint, signature:'1'.repeat(64), quoteId:'missing' });
  assert.equal(responses[1].status, 409);
  assert.match(responses[1].data.error, /matching \$200 listing quote/);
});

test('listing registration verifies the quoted base units and finalized quote window', async () => {
  const now = Date.now();
  const quote = { id:'listing_1000_0123456789abcdef', mint, payer:mint, fundedMint:mint,
    usd:200, amountTokens:6_666.666667, amountBaseUnits:'6666666667', decimals:6, tokenPriceUsd:0.03,
    createdAt:new Date(now - 60_000).toISOString(), expiresAt:new Date(now + 540_000).toISOString() };
  const state = { listings:{}, listingQuotes:{ [quote.id]:quote } };
  const responses = [];
  let confirmedAt = Math.floor(now / 1000);
  const handle = createListingPaymentsRoutes({ solanaCluster:'devnet', fundedTokenMint:mint,
    body:async req => req.input, walletKey, store:{ read:async () => state, readLaunch:async () => null,
      readMetadata:async () => null, update:async fn => fn(state) }, listingBurnAlreadyUsed:() => false,
    connectionFactory:() => ({ getGenesisHash:async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      getTokenSupply:async () => ({ value:{ decimals:6 } }) }),
    readListingMint:async () => ({ name:'Fixture', symbol:'FIX', source:'fixture', address:mint }),
    verifyListingBurn:async input => {
      assert.equal(input.amountBaseUnits, '6666666667');
      assert.equal(input.wallet, mint);
      return { amountBaseUnits:input.amountBaseUnits, blockTime:confirmedAt, slot:123,
        verifiedAt:new Date(confirmedAt * 1000).toISOString() };
    },
    respond:(_res, status, data) => responses.push({ status, data }) });
  const request = signature => handle({ method:'POST', input:{ mint, wallet:mint, signature, quoteId:quote.id } },
    {}, new URL('/api/listings', 'https://funded.vip'));
  confirmedAt = Math.floor(Date.parse(quote.expiresAt) / 1000) + 60;
  await request('1'.repeat(64));
  assert.equal(responses[0].status, 409);
  assert.deepEqual(state.listings, {});
  confirmedAt = Math.floor(now / 1000);
  await request('2'.repeat(64));
  assert.equal(responses[1].status, 201);
  assert.equal(state.listings[mint].amountBaseUnits, quote.amountBaseUnits);
  assert.equal(state.listings[mint].quoteId, quote.id);
  assert.equal(state.listings[mint].usd, 200);
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
