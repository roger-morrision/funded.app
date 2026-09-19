import assert from 'node:assert/strict';
import { APP_REFERRAL_LEVELS, FEE_DISTRIBUTION } from '../distribution-policy.js';
import { bindReferralAttribution, calculateReferralRewards, captureFirstTouch, createReferralCode, normalizeReferralCode, resolveReferralUpline, settleReferralRevenue } from '../referral-program.js';

assert.equal(normalizeReferralCode(' fnd-a1b2c3d4 '), 'FND-A1B2C3D4');
assert.equal(normalizeReferralCode('not-a-referral'), '');
assert.match(createReferralCode(Uint8Array.from([0, 1, 2, 3, 4, 5])), /^FND-[A-Z0-9]{12}$/);

const firstTouch = captureFirstTouch(null, 'fnd-a1b2c3d4', { now: '2026-09-18T00:00:00.000Z', ownCode: 'FND-DEADBEEF' });
assert.equal(firstTouch.status, 'pending-first-qualified-event');
assert.equal(firstTouch.scope, 'app-account');
assert.deepEqual(captureFirstTouch(firstTouch, 'FND-FFFFFFFF'), firstTouch);
assert.equal(captureFirstTouch(null, 'FND-DEADBEEF', { ownCode: 'FND-DEADBEEF' }), null);
assert.equal(bindReferralAttribution(firstTouch, 'wallet-a', 'FND-DEADBEEF').wallet, 'wallet-a');
assert.equal(bindReferralAttribution({ ...firstTouch, wallet: 'wallet-a' }, 'wallet-b', 'FND-DEADBEEF'), null);

assert.deepEqual(resolveReferralUpline('level-1', { 'level-1': 'level-2', 'level-2': 'level-3' }), ['level-1', 'level-2', 'level-3']);
assert.throws(() => resolveReferralUpline('level-1', { 'level-1': 'level-2', 'level-2': 'level-1' }), /cycle/);

const rewards = calculateReferralRewards(1000, { fundedPercent: FEE_DISTRIBUTION.fundedPercent, levels: APP_REFERRAL_LEVELS, upline: ['alice', 'bob', 'carol'] });
assert.equal(rewards.fundedRevenue, 200);
assert.deepEqual(rewards.allocations.map(item => item.amount), [20, 6, 4]);
assert.equal(rewards.totalReferralReward, 30);
assert.equal(rewards.unallocatedReferralRevenue, 0);
assert.equal(rewards.remainingFundedRevenue, 170);

const settled = new Map();
const firstSettlement = settleReferralRevenue({ id: 'revenue-1', grossCreatorFees: 1000 }, { fundedPercent: 20, levels: APP_REFERRAL_LEVELS, upline: ['alice'] }, settled);
const duplicateSettlement = settleReferralRevenue({ id: 'revenue-1', grossCreatorFees: 999999 }, { fundedPercent: 20, levels: APP_REFERRAL_LEVELS, upline: ['alice'] }, settled);
assert.equal(firstSettlement, duplicateSettlement);
assert.equal(firstSettlement.status, 'pending-settlement');
console.log('referral program checks passed');
