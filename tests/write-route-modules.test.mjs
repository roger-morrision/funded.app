import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { createKeeperCollectionRoutes } from '../server/routes/keeper-collection.mjs';
import { createLaunchRegistrationRoutes } from '../server/routes/launch-registration.mjs';
import { createListingPaymentsRoutes } from '../server/routes/listing-payments.mjs';
import { createSettlementRoutes } from '../server/routes/settlement.mjs';
import { createCreatorFeesRoutes } from '../server/routes/creator-fees.mjs';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { deriveMintRouterV3 } from '../mint-router-v3.js';

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

test('V3-only launch configuration cannot be enabled by flags before finalized payouts and burn', async () => {
  const f = fixture(createLaunchRegistrationRoutes, { env:{
    FUNDED_V3_LAUNCH_ENABLED:'true', FUNDED_V3_COLLECTION_ENABLED:'true',
    FUNDED_V3_SETTLEMENT_ENABLED:'true', FUNDED_V3_REWARDS_ENABLED:'true',
    FUNDED_V3_BUYBACK_ENABLED:'true', FUNDED_V3_FEE_ROUTER_PROGRAM_ID:mint,
    FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),
  }, v3AuthorityKeypair:() => ({ publicKey:new PublicKey(mint) }) });
  assert.equal(await f.request('/api/v3-launch-config', {}, 'GET'), true);
  assert.equal(f.responses[0].status, 200);
  assert.equal(f.responses[0].data.ready, false);
  assert.match(f.responses[0].data.reasons.join('; '), /V3 holder worker and OAuth-bound X claim require deployed app verification/);
  assert.match(f.responses[0].data.reasons.join('; '), /V3 public buyback route requires deployed app verification/);
  assert.equal(await f.request('/api/launch-reserve-config', {}, 'GET'), true);
  assert.equal(f.responses[1].status, 503);
  assert.match(f.responses[1].data.error, /V3 atomic community reserve is not ready/);
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
    ['keeper/collect', 'POST'], ['keeper/reconcile-v3-collection', 'POST'],
    ['keeper/reconcile-v3-settlement', 'POST']]) {
    assert.equal(await f.request(`/api/${path}`, {}, method), true);
  }
  assert.equal(await f.request('/api/keeper/reconcile-wrapped-sol', {}, 'POST'), false,
    'The keeper module does not contain a V2 recovery handler');
  assert.equal(denied, 5);
  assert.deepEqual(f.responses, [], 'The authorization helper already sent the response');
});

test('failed collection keeps its reconciliation lock and blocks replay', async () => {
  const state = { alerts: {}, collections: {} };
  let collections = 0;
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized: () => true, store: { readLaunch:async () => ({ pumpFeeRoute:{ scope:'per-mint-v3' } }),
      update: async fn => fn(state) },
    collectPumpCreatorFees: async () => { collections++; throw Error('RPC outcome uncertain'); },
  });
  await assert.rejects(f.request('/api/keeper/collect', { mint }), /RPC outcome uncertain/);
  assert.equal(state.alerts[`fee-collect:${mint}`].status, 'review-required');
  assert.equal(await f.request('/api/keeper/collect', { mint }), true);
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(collections, 1);
});

test('retired V2 collection does not create a keeper lock or send a transaction', async () => {
  let updated = false, collected = false;
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized:() => true,
    store:{ readLaunch:async () => ({ pumpFeeRoute:{ scope:'per-mint-v2' } }),
      update:async () => { updated = true; } },
    collectPumpCreatorFees:async () => { collected = true; },
  });
  await f.request('/api/keeper/collect', { mint });
  assert.equal(f.responses[0].status, 410);
  assert.equal(updated, false);
  assert.equal(collected, false);
});

test('V3 collection stays separate from V2 obligations and bookkeeping settlements', async () => {
  const state = { alerts:{}, collections:{}, obligations:{} };
  const signature = 'v3-finalized-fixture';
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized:() => true, store:{ readLaunch:async () => ({ pumpFeeRoute:{ scope:'per-mint-v3' } }),
      update:async fn => fn(state) },
    collectPumpCreatorFees:async () => ({ signature, mint, requestedMint:mint,
      scope:'per-mint-v3', status:'collected', onchainVerified:true,
      attribution:'mint-verified', collectedLamports:30, cluster:'devnet' }),
  });
  await f.request('/api/keeper/collect', { mint });
  assert.equal(f.responses[0].status, 200);
  assert.equal(state.collections[signature].scope, 'per-mint-v3');
  assert.deepEqual(state.obligations, {});
});

test('V3 collection recovery requires the recorded signature and exact finalized proof', async () => {
  const signature = '1'.repeat(64);
  const programId = mint;
  const router = deriveMintRouterV3(programId, mint).address.toBase58();
  const claimId = Buffer.alloc(32, 3);
  const collection = { signature, mint, scope:'per-mint-v3', status:'verification-pending',
    attribution:'unverified', onchainVerified:false, cluster:'devnet', programId, router };
  const state = { alerts:{ [`fee-collect:${mint}`]:{ status:'review-required' } },
    collections:{ [signature]:collection }, launches:{ [mint]:{
      mint, creatorWallet:mint, pumpFeeRoute:{ scope:'per-mint-v3', programId, router,
        initialAuthority:mint } } }, obligations:{} };
  let proof = { signature, mint, router, claimId, expectedLamports:30n, slot:123 };
  let proofReads = 0;
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized:() => true, store:{ read:async () => state, update:async fn => fn(state) },
    env:{ FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId, FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64) },
    connectionFactory:() => ({}),
    verifyV3LaunchRouterReadiness:async () => ({ ready:true, configuredRouter:router }),
    loadFinalizedV3PumpCollection:async () => { proofReads++; return proof; },
  });
  const path = '/api/keeper/reconcile-v3-collection';
  await f.request(path, { mint, signature:'2'.repeat(64) });
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(proofReads, 0);
  proof = { ...proof, expectedLamports:undefined };
  await f.request(path, { mint, signature });
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(state.collections[signature].status, 'verification-pending');
  proof = { ...proof, expectedLamports:29n };
  state.collections[signature].collectedLamports = 30;
  await f.request(path, { mint, signature });
  assert.equal(f.responses.at(-1).status, 409);
  assert.equal(state.collections[signature].status, 'verification-pending');
  proof = { ...proof, expectedLamports:30n };
  await f.request(path, { mint, signature });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(state.collections[signature].status, 'collected');
  assert.equal(state.collections[signature].claimId, claimId.toString('hex'));
  assert.equal(state.collections[signature].collectedLamports, 30);
  assert.equal(state.alerts[`fee-collect:${mint}`].status, 'complete');
  assert.deepEqual(state.obligations, {}, 'V3 collection cannot create V2 reward obligations');
  await f.request(path, { mint, signature });
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(state.collections[signature].collectedLamports, 30);
});

test('V3 settlement reconciliation records only the matching finalized category claim', async () => {
  const collectionSignature = '1'.repeat(64);
  const settlementSignature = '2'.repeat(64);
  const programId = mint;
  const router = deriveMintRouterV3(programId, mint).address.toBase58();
  const claimId = Buffer.alloc(32, 4);
  const state = { collections:{ [collectionSignature]:{
    signature:collectionSignature, mint, scope:'per-mint-v3', cluster:'devnet',
    status:'collected', attribution:'mint-verified', onchainVerified:true,
    programId, router, collectedLamports:30, claimId:claimId.toString('hex'),
  } }, launches:{ [mint]:{ mint, creatorWallet:mint, cluster:'devnet', onchainVerified:true,
    pumpFeeRoute:{ scope:'per-mint-v3', programId, router, initialAuthority:mint },
    feeDistribution:buildFeeDistributionPolicy({ creatorWalletPercent:60,
      holderAirdropPercent:20, solClaimPercent:0 }) } },
  v3Settlements:{}, settlements:{}, obligations:{} };
  let settlementProof = { signature:settlementSignature, mint, router,
    claimId:claimId.toString('hex'), expectedLamports:'29', slot:42,
    categoryLamports:['24','3','1','1','0','1','0'] };
  const f = fixture(createKeeperCollectionRoutes, {
    requireAuthorized:() => true, store:{ read:async () => state, update:async fn => fn(state) },
    env:{ FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId, FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64) },
    connectionFactory:() => ({}),
    verifyV3LaunchRouterReadiness:async () => ({ ready:true, configuredRouter:router }),
    loadFinalizedV3PumpCollection:async () => ({ signature:collectionSignature,
      router, expectedLamports:30n, claimId }),
    loadFinalizedV3Settlement:async () => settlementProof,
  });
  const path = '/api/keeper/reconcile-v3-settlement';
  const input = { collectionSignature, settlementSignature };
  await f.request(path, input);
  assert.equal(f.responses.at(-1).status, 409);
  assert.deepEqual(state.v3Settlements, {});
  settlementProof = { ...settlementProof, expectedLamports:'30' };
  await f.request(path, input);
  assert.equal(f.responses.at(-1).status, 200);
  assert.equal(state.v3Settlements[collectionSignature].status, 'finalized');
  assert.equal(state.v3Settlements[collectionSignature].settlementSignature, settlementSignature);
  assert.equal(state.v3Settlements[collectionSignature].allocationPlan.status, 'allocated-not-funded');
  assert.equal(state.v3Settlements[collectionSignature].allocationPlan.creatorDirected.walletLamports, '18');
  assert.equal(state.v3Settlements[collectionSignature].allocationPlan.creatorDirected.holderLamports, '6');
  assert.deepEqual(state.settlements, {});
  assert.deepEqual(state.obligations, {});
  await f.request(path, input);
  assert.equal(f.responses.at(-1).status, 200);
  await f.request(path, { collectionSignature, settlementSignature:'3'.repeat(64) });
  assert.equal(f.responses.at(-1).status, 409);
});

test('keeper lists V3 candidates only when enabled and excludes them from V2 settlements', async () => {
  const v3Mint = new PublicKey(new Uint8Array(32).fill(4)).toBase58();
  const state = { launches:{
    [mint]:{ mint, creator:mint, onchainVerified:true, cluster:'devnet',
      pumpFeeRoute:{ scope:'per-mint-v2', router:mint } },
    [v3Mint]:{ mint:v3Mint, creator:v3Mint, onchainVerified:true, cluster:'devnet',
      pumpFeeRoute:{ scope:'per-mint-v3', router:v3Mint, programId:mint } },
  }, collections:{ v3proof:{ signature:'v3proof', mint:v3Mint, scope:'per-mint-v3',
    status:'collected', onchainVerified:true, attribution:'mint-verified', cluster:'devnet',
    programId:mint, collectedLamports:30, claimId:'01'.repeat(32) } },
  settlements:{}, v3Settlements:{}, alerts:{} };
  const f = fixture(createKeeperCollectionRoutes, { requireAuthorized:() => true,
    store:{ read:async () => state }, automaticRewardStore:{ read:async () => ({ fundingRequests:{} }) },
    solToLamports:() => 0 });
  const previous = process.env.FUNDED_V3_COLLECTION_ENABLED;
  try {
    delete process.env.FUNDED_V3_COLLECTION_ENABLED;
    await f.request('/api/keeper/collection-candidates', {}, 'GET');
    assert.deepEqual(f.responses[0].data.mints.map(row => row.mint), []);
    assert.deepEqual(f.responses[0].data.pendingSettlements, []);
    assert.equal(f.responses[0].data.pendingV3Settlements[0].collectionSignature, 'v3proof');
    process.env.FUNDED_V3_COLLECTION_ENABLED = 'true';
    await f.request('/api/keeper/collection-candidates', {}, 'GET');
    assert.deepEqual(f.responses[1].data.mints.map(row => row.mint), [v3Mint]);
    state.v3Settlements.v3proof = { status:'verification-pending' };
    await f.request('/api/keeper/collection-candidates', {}, 'GET');
    assert.equal(f.responses[2].data.pendingV3Settlements[0].status, 'verification-pending');
    state.v3Settlements.v3proof = { status:'finalized' };
    await f.request('/api/keeper/collection-candidates', {}, 'GET');
    assert.deepEqual(f.responses[3].data.pendingV3Settlements, []);
  } finally {
    if (previous === undefined) delete process.env.FUNDED_V3_COLLECTION_ENABLED;
    else process.env.FUNDED_V3_COLLECTION_ENABLED = previous;
  }
});

test('fee activity exposes only verified V3 collections and their signing gates', async () => {
  const prior = process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
  process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID = mint;
  const v3Mint = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
  const router = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
  const state = { launches:{ [v3Mint]:{ mint:v3Mint, cluster:'devnet', onchainVerified:true,
    creator:router, creatorWallet:router, pumpFeeRoute:{ scope:'per-mint-v3', router, programId:mint } } },
  collections:{ good:{ signature:'good', mint:v3Mint, scope:'per-mint-v3', router,
    programId:mint, status:'collected', onchainVerified:true, collectedLamports:100 },
    old:{ signature:'old', mint:v3Mint, scope:'per-mint-v2', router,
      programId:mint, status:'collected', onchainVerified:true, collectedLamports:100 } },
  v3Settlements:{ good:{ status:'finalized', allocationPlan:{ status:'allocated-not-funded' } } } };
  try {
    const f = fixture(createCreatorFeesRoutes, { solanaRpcUrl:'invalid-rpc-url',
      route:(path, method, pattern) => method ? path.match(pattern)?.[1] : null,
      store:{ read:async () => state, readCoinFeeActivity:async () => ({ collections:[] }) },
      automaticRewardStore:{ read:async () => ({}) },
      feeRouterConfig:() => assert.fail('V3 overview must not read V2 router configuration') });
    await f.request(`/api/tokens/${v3Mint}/fee-activity`, {}, 'GET');
    assert.equal(f.responses[0].status, 200);
    assert.equal(f.responses[0].data.overview.scope, 'per-mint-v3');
    assert.deepEqual(f.responses[0].data.overview.collections.map(row => row.signature), ['good']);
    assert.equal(f.responses[0].data.overview.collections[0].settlement, 'finalized');
  } finally {
    if (prior === undefined) delete process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID;
    else process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID = prior;
  }
});

test('launch registration rejects unsupported networks, new V2 launches, and unready V3', async () => {
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
  await f.request('/api/launches', { ...input, pumpFeeRoute: { router: mint, scope: 'per-mint-v3',
    programId:mint, initialAuthority:mint, protocolSplit:{ operationsPercent:50,
      referralLevelPercents:[10,3,2], communityPercent:10, buybackPercent:25 } } });
  assert.deepEqual(f.responses.map(row => row.status), [400, 410, 410, 503]);
  assert.match(f.responses[1].data.error, /V2 launch registration is retired/);
  assert.match(f.responses[2].data.error, /V2 launch registration is retired/);
  assert.match(f.responses[3].data.error, /V3 normal flows are not ready/);
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

test('V3 fees cannot be recorded or queued by the legacy bookkeeping route', async () => {
  const signature = 'v3-unsettled-collection';
  const state = { settlements: {}, collections: { [signature]: {
    signature, status:'collected', attribution:'mint-verified', cluster:'devnet', mint,
    collectedLamports:'10000000', recordedAt:'2026-10-12T00:00:00Z',
  } }, launches: { [mint]: { onchainVerified:true, cluster:'devnet', creatorWallet:mint,
    pumpFeeRoute:{ scope:'per-mint-v3' },
    feeDistribution:buildFeeDistributionPolicy({ creatorWalletPercent:80 }),
  } } };
  const f = fixture(createSettlementRoutes, { store:{ update:async fn => fn(state) },
    queueAutomaticSettlementRewards:() => assert.fail('Unsettled V3 fees queued') });
  await assert.rejects(f.request('/api/settlements/claims', { claimSignature:signature }),
    /finalized on-chain category claim/);
  assert.deepEqual(state.settlements, {});
});
