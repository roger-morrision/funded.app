import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { createRewardScheduler, holderFundingMinimumLamports,
  holderPoolMinimumLamports, holderUsdEligibility } from '../server/reward-scheduler.mjs';
import { QA_HOLDER_POLICY, qaHolderMinimums } from '../server/devnet-qa-minimums.mjs';

const mint = 'FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH';
const qa = { SOLANA_CLUSTER:'devnet', FUNDED_QA_SHORT_REWARD_PERIODS:'true', FUNDED_QA_HOLDER_MINT:mint, FUNDED_QA_HOLDER_MIN_LAMPORTS:'800000' };
const standard = 10_000_000n;

test('hourly QA holder minimums are bounded to one Devnet mint and persist on the program', async () => {
  const env = { FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'true',
    FUNDED_DEVNET_QA_HOLDER_MINT:mint, FUNDED_DEVNET_QA_HOLDER_MIN_USD:'1',
    FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD:'0.50',
    FUNDED_DEVNET_QA_HOLDER_MIN_LAMPORTS:'1000000' };
  const minimums = qaHolderMinimums(mint, 'devnet', env);
  assert.deepEqual(minimums, { minimumHolderUsd:1,
    minimumPoolUsd:0.5, minimumFundingLamports:1_000_000 });
  assert.equal(qaHolderMinimums('another-mint', 'devnet', env), null);
  assert.equal(qaHolderMinimums(mint, 'devnet', { ...env,
    FUNDED_DEVNET_QA_MINIMUMS_ENABLED:'false' }), null);
  assert.throws(() => qaHolderMinimums(mint, 'mainnet-beta', env), /outside Devnet/);
  assert.throws(() => qaHolderMinimums(mint, 'devnet', { ...env,
    FUNDED_DEVNET_QA_HOLDER_MIN_USD:'0' }), /positive integer/);
  assert.throws(() => qaHolderMinimums(mint, 'devnet', { ...env,
    FUNDED_DEVNET_QA_HOLDER_MIN_LAMPORTS:'10000000' }), /bounded Devnet QA range/);
  for (const pool of ['0.09', '20', '0.501', '-0.5'])
    assert.throws(() => qaHolderMinimums(mint, 'devnet', { ...env,
      FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD:pool }), /POOL_MIN_USD/);
  const config = { mint, periodSeconds:3600, eligibilityPolicy:QA_HOLDER_POLICY,
    qaMinimums:minimums };
  assert.equal(holderFundingMinimumLamports(config, { SOLANA_CLUSTER:'devnet' }), 1_000_000n);
  assert.throws(() => holderFundingMinimumLamports(config, { SOLANA_CLUSTER:'mainnet-beta' }), /outside Devnet/);
  const quote = { tokenPriceUsd:0.02, solUsd:200, decimals:6,
    source:'verified-test-quote', observedAt:new Date().toISOString() };
  const wallet = '11111111111111111111111111111111';
  assert.deepEqual([...holderUsdEligibility(quote, [{ wallet, balance:'50000000' }], [], 1).eligible], [wallet]);
  assert.equal(holderPoolMinimumLamports(config, quote, 1, { SOLANA_CLUSTER:'devnet' }), 2_550_000n);
  const oldCluster = process.env.SOLANA_CLUSTER;
  process.env.SOLANA_CLUSTER = 'devnet';
  try {
    const state = { programs:{ [mint]:{ mint, enabled:true, asset:'SOL', kind:'holder',
      periodSeconds:3600, eligibilityPolicy:'usd-20-hourly-v1',
      activatedAt:3600, firstPeriodStart:3600 } },
      schedules:{ old:{ mint, kind:'holder', periodStart:3600, cutoffAt:7200,
        status:'indexing', payments:{} }, next:{ mint, kind:'holder', periodStart:7200,
        cutoffAt:10800, status:'blocked', reason:'Old policy', payments:{} },
        paid:{ mint, kind:'holder', periodStart:0,
        cutoffAt:3600, status:'paid', cycle:'immutable-cycle', payments:{} } } };
    const scheduler = createRewardScheduler({ store:{ transaction:async callback => callback(state) },
      indexer:{}, chain:{} });
    await scheduler.register({ ...config, asset:'SOL', activatedAt:3600,
      firstPeriodStart:7200, sampleIntervalSeconds:300, payoutDelaySeconds:0 });
    assert.equal(state.programs[mint].eligibilityPolicy, QA_HOLDER_POLICY);
    assert.deepEqual(state.programs[mint].qaMinimums, minimums);
    assert.equal(state.schedules.old.status, 'skipped');
    assert.equal(state.schedules.next.status, 'indexing');
    assert.equal(state.schedules.paid.status, 'paid');
  } finally {
    if (oldCluster === undefined) delete process.env.SOLANA_CLUSTER;
    else process.env.SOLANA_CLUSTER = oldCluster;
  }
});

test('a verified small Devnet pool prepares only under the selected hourly QA policy', async () => {
  const previous = process.env.SOLANA_CLUSTER;
  process.env.SOLANA_CLUSTER = 'devnet';
  try {
    const start = Math.floor(Date.now() / 3_600_000) * 3600 - 3600;
    const wallet = '11111111111111111111111111111111';
    const minimums = { minimumHolderUsd:1, minimumPoolUsd:0.5,
      minimumFundingLamports:1_000_000 };
    const quote = { tokenPriceUsd:0.02, solUsd:200, decimals:6,
      source:'verified-test-quote', observedAt:new Date().toISOString() };
    const base = { programs:{ [mint]:{ mint, asset:'SOL', kind:'holder', enabled:true,
      periodSeconds:3600, sampleIntervalSeconds:1800, payoutDelaySeconds:0,
      activatedAt:start, firstPeriodStart:start, excludedWallets:[],
      eligibilityPolicy:QA_HOLDER_POLICY, qaMinimums:minimums } },
      schedules:{}, rewardPools:{ pool:{ id:'pool', mint, asset:'SOL',
        status:'available', amount:'6000000', fundedAt:start+100,
        balanceDeltaVerified:true } },
      holderSnapshots:{ [mint]:[start,start+1800,start+3600].map((at, slot) => ({
        at, slot:slot+1, finalized:true,
        accounts:[{ account:'holder', wallet, balance:'50000000' }] })) } };
    const state = structuredClone(base);
    const scheduler = createRewardScheduler({ store:{ read:async () => structuredClone(state),
      transaction:async callback => callback(state) }, indexer:{}, chain:{},
      quoteReader:async () => quote });
    await scheduler.prepare(start+3600);
    const row = state.schedules[`${mint}:${start}:holder:SOL`];
    assert.equal(row.status, 'prepared', row.reason);
    assert.equal(row.eligibility.policy, QA_HOLDER_POLICY);
    assert.equal(row.eligibility.minimumPoolLamports, '2550000');
    assert.deepEqual(row.manifest.leaves.map(leaf => leaf.recipient), [wallet]);
    const normal = structuredClone(base);
    normal.programs[mint].eligibilityPolicy = 'usd-20-hourly-v1';
    normal.programs[mint].qaMinimums = null;
    await createRewardScheduler({ store:{ read:async () => structuredClone(normal),
      transaction:async callback => callback(normal) }, indexer:{}, chain:{},
      quoteReader:async () => quote }).prepare(start+3600);
    assert.equal(normal.schedules[`${mint}:${start}:holder:SOL`].status, 'deferred');
  } finally {
    if (previous === undefined) delete process.env.SOLANA_CLUSTER;
    else process.env.SOLANA_CLUSTER = previous;
  }
});

test('selected Devnet QA mint can use five-minute periods without losing bounded minimums or funding', async () => {
  const previous = Object.fromEntries(['SOLANA_CLUSTER', 'FUNDED_QA_SHORT_REWARD_PERIODS',
    'FUNDED_QA_HOLDER_MINT'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { SOLANA_CLUSTER:'devnet',
    FUNDED_QA_SHORT_REWARD_PERIODS:'true', FUNDED_QA_HOLDER_MINT:mint });
  const start = Math.floor(Date.now() / 300_000) * 300 - 300;
  const wallet = '11111111111111111111111111111111';
  const minimums = { minimumHolderUsd:1, minimumPoolUsd:0.5,
    minimumFundingLamports:1_000_000 };
  assert.equal(holderFundingMinimumLamports({ mint, periodSeconds:300,
    eligibilityPolicy:QA_HOLDER_POLICY, qaMinimums:minimums },
    { SOLANA_CLUSTER:'devnet' }), 1_000_000n);
  const state = { programs:{ [mint]:{ mint, enabled:true, asset:'SOL', kind:'holder',
    periodSeconds:3600, sampleIntervalSeconds:300, payoutDelaySeconds:0,
    activatedAt:start - 3600, firstPeriodStart:start - 3600,
    eligibilityPolicy:QA_HOLDER_POLICY, qaMinimums:minimums } },
    schedules:{ old:{ mint, kind:'holder', periodStart:start - 3600,
      cutoffAt:start, status:'indexing', payments:{} } },
    rewardPools:{ pool:{ id:'pool', mint, asset:'SOL', status:'available',
      amount:'6000000', fundedAt:start - 60, balanceDeltaVerified:true } },
    holderSnapshots:{ [mint]:[start - 60, start + 60, start + 180, start + 299]
      .map((at, index) => ({ at, slot:index + 1, finalized:true,
        accounts:[{ account:'holder', wallet, balance:'50000000' }] })) } };
  const store = { read:async () => structuredClone(state),
    transaction:async callback => callback(state) };
  const scheduler = createRewardScheduler({ store, indexer:{}, chain:{},
    quoteReader:async () => ({ tokenPriceUsd:0.02, solUsd:200, decimals:6,
      source:'verified-test-quote', observedAt:new Date().toISOString() }) });
  try {
    await scheduler.register({ mint, asset:'SOL', activatedAt:start - 3600,
      firstPeriodStart:start, periodSeconds:300, sampleIntervalSeconds:60,
      payoutDelaySeconds:0, eligibilityPolicy:QA_HOLDER_POLICY,
      qaMinimums:minimums });
    assert.equal(state.programs[mint].periodSeconds, 300);
    assert.deepEqual(state.programs[mint].qaMinimums, minimums);
    assert.equal(state.schedules.old.status, 'skipped');
    assert.equal(state.rewardPools.pool.status, 'available');
    await scheduler.prepare(start + 300);
    const row = state.schedules[`${mint}:${start}:holder:SOL`];
    assert.equal(row.status, 'prepared', row.reason);
    assert.deepEqual(row.manifest.leaves.map(leaf => leaf.recipient), [wallet]);
    assert.equal(state.rewardPools.pool.status, 'assigned');
    await assert.rejects(() => scheduler.register({ mint:'another-mint', asset:'SOL',
      activatedAt:start - 3600, firstPeriodStart:start, periodSeconds:300,
      sampleIntervalSeconds:60, payoutDelaySeconds:0,
      eligibilityPolicy:QA_HOLDER_POLICY, qaMinimums:minimums }), /Invalid reward schedule timing/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('the short-period Devnet test can lower only its selected mint minimum', () => {
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:300}, qa), 800_000n);
  assert.equal(holderFundingMinimumLamports({mint:'another-mint', periodSeconds:300}, qa), standard);
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:86400}, qa), standard);
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:300}, {...qa, SOLANA_CLUSTER:'mainnet-beta'}), standard);
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:300}, {...qa, FUNDED_QA_SHORT_REWARD_PERIODS:'false'}), standard);
});

test('hourly holder policy requires priced closing balances and a pool that covers the cost allowance', async () => {
  const large = '11111111111111111111111111111111';
  const small = '22222222222222222222222222222222';
  const curveWallet = bondingCurvePda(new PublicKey(mint)).toBase58();
  const quote = { tokenPriceUsd:0.02, solUsd:200, decimals:6,
    source:'verified-test-quote', observedAt:new Date().toISOString() };
  const eligible = holderUsdEligibility(quote, [
    { wallet:large, balance:'2000000000' },
    { wallet:small, balance:'500000000' },
    { wallet:'pool', balance:'9000000000' },
  ], ['pool']);
  assert.deepEqual([...eligible.eligible], [large]);
  assert.equal(eligible.minimumTokenUnits, '1000000000');
  assert.equal(holderPoolMinimumLamports({ mint, periodSeconds:3600 }, quote, 1),
    100_050_000n);
  assert.throws(() => holderUsdEligibility(null, [], []), /fresh verified token price/);

  const start = Math.floor(Date.now() / 3_600_000) * 3600 - 3600;
  const state = { programs:{ [mint]:{ mint, asset:'SOL', kind:'holder', enabled:true,
      periodSeconds:3600, sampleIntervalSeconds:1800, payoutDelaySeconds:0,
      activatedAt:start, firstPeriodStart:start,
      eligibilityPolicy:'usd-20-hourly-v1', excludedWallets:[] } },
    schedules:{}, rewardPools:{ pool:{ id:'pool', mint, asset:'SOL', status:'available',
      amount:'120000000', fundedAt:start+100, balanceDeltaVerified:true } },
    holderSnapshots:{ [mint]:[start,start+1800,start+3599].map((at, index) => ({
      at, slot:index+1, finalized:true, accounts:[
        { account:'large', wallet:large, balance:'2000000000' },
        { account:'small', wallet:small, balance:'500000000' },
        { account:'curve', wallet:curveWallet, balance:'9000000000' },
      ] })) } };
  const noPrice = structuredClone(state);
  await createRewardScheduler({ store:{ read:async () => structuredClone(noPrice),
    transaction:async callback => callback(noPrice) }, indexer:{}, chain:{},
    quoteReader:async () => null }).prepare(start+3600);
  assert.equal(noPrice.schedules[`${mint}:${start}:holder:SOL`].status, 'blocked');
  assert.equal(noPrice.rewardPools.pool.status, 'available');
  const store = { read:async () => structuredClone(state),
    transaction:async callback => callback(state) };
  await createRewardScheduler({ store, indexer:{}, chain:{},
    quoteReader:async () => quote }).prepare(start+3600);
  const row = state.schedules[`${mint}:${start}:holder:SOL`];
  assert.equal(row.status, 'prepared', row.reason);
  assert.deepEqual(row.manifest.leaves.map(leaf => leaf.recipient), [large]);
  assert.equal(row.eligibility.minimumPoolLamports, '100050000');
  assert.equal(row.eligibility.eligibleCount, 1);
});

test('hourly migration skips only unfinished daily periods and preserves prepared payouts', async () => {
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const daily = { mint, asset:'SOL', kind:'holder', enabled:true,
    periodSeconds:86400, sampleIntervalSeconds:300, payoutDelaySeconds:3600,
    activatedAt:now-86400, firstPeriodStart:now-86400, excludedWallets:[] };
  const state = { programs:{ [mint]:daily }, schedules:{
    pending:{ mint, kind:'holder', periodStart:now-86400, cutoffAt:now,
      status:'indexing', payments:{} },
    prepared:{ mint, kind:'holder', periodStart:now-86400, cutoffAt:now,
      status:'prepared', manifest:{ leaves:[{ recipient:'wallet', amount:'1' }] },
      payments:{} },
  } };
  await createRewardScheduler({ store:{ transaction:async callback => callback(state) },
    indexer:{}, chain:{} }).register({ ...daily, periodSeconds:3600,
    payoutDelaySeconds:0, firstPeriodStart:now+3600,
    eligibilityPolicy:'usd-20-hourly-v1' });
  assert.equal(state.programs[mint].periodSeconds, 3600);
  assert.equal(state.schedules.pending.status, 'skipped');
  assert.equal(state.schedules.prepared.status, 'prepared');
});

test('an enabled Devnet QA override rejects missing or unsafe amounts', () => {
  for (const amount of ['', '99999', '10000000', '0.8', '-1', 'abc']) {
    assert.throws(() => holderFundingMinimumLamports({mint, periodSeconds:300}, {...qa, FUNDED_QA_HOLDER_MIN_LAMPORTS:amount}));
  }
});

test('a temporary QA period preserves the existing daily schedule', async () => {
  const previous = Object.fromEntries(Object.keys(qa).map(key => [key, process.env[key]]));
  Object.assign(process.env, qa);
  const now = Math.floor(Date.now() / 300) * 300 + 20;
  const firstPeriodStart = Math.ceil(now / 300) * 300;
  const daily = { id:'daily', mint, kind:'holder', asset:'SOL', periodStart:now - 3600, cutoffAt:now + 7200, payoutAt:now + 10800, status:'indexing', payments:{} };
  const state = { programs:{[mint]:{mint,enabled:true,asset:'SOL',kind:'holder',periodSeconds:300,sampleIntervalSeconds:30,payoutDelaySeconds:0,activatedAt:now - 1000,firstPeriodStart}}, schedules:{daily}, holderSnapshots:{}, rewardPools:{} };
  const store = { transaction: async callback => callback(state) };
  try {
    await createRewardScheduler({store,indexer:{},chain:{}}).prepare(now);
    assert.equal(state.schedules.daily.status, 'indexing');
  } finally {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a finalized V3 holder pool can be re-enrolled after its period is assigned', async () => {
  const state = { rewardPools:{} };
  const scheduler = createRewardScheduler({
    store:{ transaction:async callback => callback(state) }, indexer:{}, chain:{} });
  const funding = { id:'v3:collection', mint, asset:'SOL', amount:'1200000',
    fundedAt:1_700_000_000, fundingSignature:'finalized-v3-funding',
    balanceDeltaVerified:true };
  await scheduler.recordFundedPool(funding);
  state.rewardPools[funding.id].status = 'assigned';
  state.rewardPools[funding.id].scheduleId = 'holder-cycle';
  await scheduler.recordFundedPool(funding);
  assert.equal(state.rewardPools[funding.id].scheduleId, 'holder-cycle');
  await assert.rejects(scheduler.recordFundedPool({ ...funding, amount:'1200001' }),
    /different immutable funding data/);
});

test('a direct X payout cannot replay its ID against different finalized funding', async () => {
  const state = { schedules:{} };
  const scheduler = createRewardScheduler({
    store:{ transaction:async callback => callback(state) }, indexer:{}, chain:{} });
  const input = { id:'collection', mint, recipient:'ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC',
    asset:'SOL', kind:'x', amount:'1000000', fundingSignature:'finalized-a',
    balanceDeltaVerified:true, fundedAt:1_700_000_000 };
  await scheduler.recordDirectFunded(input);
  await scheduler.recordDirectFunded(input);
  await assert.rejects(scheduler.recordDirectFunded({ ...input,
    fundingSignature:'finalized-b' }), /different immutable data/);
});

test('a prepared holder manifest containing the configured reward vault is blocked before any payout', async () => {
  const vault = '2RmwjWSpj8dsgjPgpHFnHYsGz3PMjKiysJjz6Jz2ZTrd';
  const state = { programs:{ [mint]:{ excludedWallets:[vault] } },
    schedules:{ qa:{ id:'qa', mint, kind:'holder', asset:'SOL', payoutAt:1,
      status:'prepared', manifest:{ leaves:[{ recipient:vault, amount:'7387' }] },
      payments:{} } } };
  const scheduler = createRewardScheduler({
    store:{ transaction:async callback => callback(state) }, indexer:{},
    chain:{ readiness:async () => ({ constrainedPayouts:true }),
      ensureCycle:async () => assert.fail('Invalid manifest must never reach the chain') } });
  const result = await scheduler.execute(2);
  assert.equal(result.submitted, 0);
  assert.equal(state.schedules.qa.status, 'blocked');
  assert.match(state.schedules.qa.reason, /protocol-owned vault/);
});

test('a partly paid holder cycle stays blocked when a QA program moves to a later period', async () => {
  const now = 1_700_000_600;
  const row = { id:'old', mint, kind:'holder', asset:'SOL', periodStart:now - 600,
    cutoffAt:now - 300, payoutAt:now - 300, status:'skipped', cycle:'onchain-cycle',
    manifest:{ leaves:[{ recipient:'wallet-a' }, { recipient:'wallet-b' }] },
    payments:{ 'wallet-a':{ status:'paid', signature:'finalized-payment' },
      'wallet-b':{ status:'verification-pending' } } };
  const state = { programs:{ [mint]:{ mint, enabled:true, asset:'SOL', kind:'holder',
    periodSeconds:300, sampleIntervalSeconds:300, payoutDelaySeconds:0,
    activatedAt:now - 900, firstPeriodStart:now } },
    schedules:{ old:row }, holderSnapshots:{}, rewardPools:{} };
  const scheduler = createRewardScheduler({
    store:{ transaction:async callback => callback(state) }, indexer:{}, chain:{} });
  await scheduler.prepare(now);
  assert.equal(row.status, 'blocked');
  assert.equal(row.payments['wallet-a'].signature, 'finalized-payment');
  assert.match(row.reason, /immutable manifest/);
});
