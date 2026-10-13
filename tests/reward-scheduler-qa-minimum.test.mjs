import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardScheduler, holderFundingMinimumLamports } from '../server/reward-scheduler.mjs';

const mint = 'FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH';
const qa = { SOLANA_CLUSTER:'devnet', FUNDED_QA_SHORT_REWARD_PERIODS:'true', FUNDED_QA_HOLDER_MINT:mint, FUNDED_QA_HOLDER_MIN_LAMPORTS:'800000' };
const standard = 10_000_000n;

test('the short-period Devnet test can lower only its selected mint minimum', () => {
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:300}, qa), 800_000n);
  assert.equal(holderFundingMinimumLamports({mint:'another-mint', periodSeconds:300}, qa), standard);
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:86400}, qa), standard);
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:300}, {...qa, SOLANA_CLUSTER:'mainnet-beta'}), standard);
  assert.equal(holderFundingMinimumLamports({mint, periodSeconds:300}, {...qa, FUNDED_QA_SHORT_REWARD_PERIODS:'false'}), standard);
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
