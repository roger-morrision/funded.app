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
