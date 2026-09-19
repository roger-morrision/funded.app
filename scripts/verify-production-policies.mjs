import assert from 'node:assert/strict';
import { allocateProRataRewards, buildRewardCycle, validateRewardConfig } from '../reward-policy.js';
import { analyzeLaunchActivity } from '../anti-sniper-policy.js';
import { buildProductionReadiness } from '../production-readiness.js';

assert.equal(validateRewardConfig({ transferFeeBps: 100 }).valid, true);
assert.equal(validateRewardConfig({ transferFeeBps: 200 }).valid, false);
const rewards = allocateProRataRewards({ distributableAmount: 97.5, holders: [{ wallet: 'A', balance: 70, valueUsd: 100 }, { wallet: 'B', balance: 30, valueUsd: 50 }, { wallet: 'dust', balance: 1000, valueUsd: 1 }] });
assert.equal(rewards.eligibleHolders, 2);
assert.ok(Math.abs(rewards.payouts.reduce((sum, payout) => sum + payout.amount, 0) - 97.5) < 0.000001);
assert.equal(buildRewardCycle({ cycleSignature: 'cycle-1', transferFeeBps: 300, withheldAmount: 100, holders: [{ wallet: 'A', balance: 1, valueUsd: 25 }] }).status, 'ready-to-payout');
const review = analyzeLaunchActivity({ creatorWallet: 'creator', launchTimestamp: 100, trades: [{ timestamp: 101, wallet: 'A', funder: 'f', slot: 1 }, { timestamp: 102, wallet: 'B', funder: 'f', slot: 1 }, { timestamp: 103, wallet: 'C', funder: 'f', slot: 1 }] });
assert.equal(review.status, 'review');
assert.ok(review.flags.includes('funding-cluster'));
assert.equal(buildProductionReadiness({}).ready, false);
console.log('production policy checks passed');
