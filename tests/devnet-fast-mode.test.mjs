import test from 'node:test';
import assert from 'node:assert/strict';
import { qaHolderMinimums, qaMintSelected, qaShortHolderMintSelected, feeCollectionMinimumLamports } from '../server/devnet-qa-minimums.mjs';
import { bonusSchedule, bonusWindowKey, bonusWindow } from '../server/daily-bonus-schedule.mjs';
import { assertBonusNetwork } from '../server/daily-bonus-network.mjs';

const MINT = 'G4thnUUDeqrfPvLLLxeGcTTXzjut5qneCquqk1Bc5BMQ';
const fast = { FUNDED_DEVNET_QA_MINIMUMS_ENABLED: 'true', FUNDED_DEVNET_QA_ALL_MINTS: 'true', FUNDED_QA_SHORT_REWARD_PERIODS: 'true',
  FUNDED_DEVNET_QA_HOLDER_MIN_USD: '0.01', FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD: '0.001', FUNDED_DEVNET_QA_HOLDER_MIN_LAMPORTS: '10000',
  FUNDED_DEVNET_QA_FEE_COLLECTION_MIN_LAMPORTS: '100000', FUNDED_DEVNET_QA_BONUS_PERIOD_SECONDS: '300' };

test('Devnet fast mode applies the QA timers and minimums to every coin', () => {
  assert.equal(qaMintSelected(MINT, 'devnet', fast), true);
  assert.equal(qaShortHolderMintSelected(MINT, 'devnet', fast), true);
  assert.equal(feeCollectionMinimumLamports(MINT, 'devnet', fast), 100000n);
  assert.deepEqual(qaHolderMinimums(MINT, 'devnet', fast), { minimumHolderUsd: 0.01, minimumPoolUsd: 0.001, minimumFundingLamports: 10000 });
});

test('Devnet fast mode is refused outside Devnet and inert without the QA master switch', () => {
  assert.throws(() => qaMintSelected(MINT, 'mainnet-beta', fast), /outside Devnet/);
  assert.equal(qaMintSelected(MINT, 'devnet', { ...fast, FUNDED_DEVNET_QA_MINIMUMS_ENABLED: 'false' }), false);
  assert.equal(qaMintSelected(MINT, 'devnet', { ...fast, FUNDED_DEVNET_QA_ALL_MINTS: 'false' }), false);
});

test('five-minute bonus windows can cover every Devnet coin', () => {
  const schedule = bonusSchedule({ cluster: 'devnet', env: fast });
  assert.equal(schedule.periodSeconds, 300);
  assert.equal(schedule.allMints, true);
  assert.equal(schedule.mints, null);
  const key = bonusWindowKey(1_794_625_200, schedule);
  assert.match(key, /^qa5m:.*@[a-f0-9]{12}$/);
  assert.equal(bonusWindow(key, 1_794_626_000).cohort, schedule.cohort);
  assert.throws(() => assertBonusNetwork('mainnet-beta', { schedule }), /forbidden outside Devnet/);
});

test('Devnet test builds accept a 5-minute developer lock and promotion interval', async () => {
  const { normalizeDeveloperLockSeconds, DEVELOPER_TOKEN_LOCK_PERIODS } = await import('../developer-lock-period.js');
  const { validateAgencyRules } = await import('../config/agency-rules.js');
  assert.equal(normalizeDeveloperLockSeconds(300), 300);
  assert.throws(() => normalizeDeveloperLockSeconds(600), /6h, 12h, 24h or 48h/);
  // The reviewed Mainnet manifest still lists only the standard periods.
  assert.deepEqual(DEVELOPER_TOKEN_LOCK_PERIODS, [21600, 43200, 86400, 172800]);
  assert.equal(validateAgencyRules({ marketCapUsd: [1, 2], communityWindowSeconds: 300, promotionIntervalSeconds: 300 }).promotionIntervalSeconds, 300);
  assert.throws(() => validateAgencyRules({ marketCapUsd: [1, 2], communityWindowSeconds: 300, promotionIntervalSeconds: 299 }));
});

test('five-minute bonus windows only cover the last two hours, not every window since the first launch', async () => {
  const { dailyBonusWork } = await import('../server/daily-bonus-queue.mjs');
  const schedule = bonusSchedule({ cluster: 'devnet', env: fast }), now = 1_794_640_000;
  const app = { launches: { a: { mint: 'a', cluster: 'devnet', onchainVerified: true, createdTimestamp: now - 7 * 86400,
    feeDistribution: { fixedFunded: { communityRewards: { dailyBonus: { version: 1 } } } } } } };
  const work = dailyBonusWork({ app, ledger: {}, now, cluster: 'devnet', programId: 'p', schedule, limit: 1000 });
  assert.equal(work.missing.length, 24);
});
