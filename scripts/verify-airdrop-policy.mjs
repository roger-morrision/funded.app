import assert from 'node:assert/strict';
import { buildCommunityAirdropPolicy, buildLaunchReservePlan, calculateProRataClaim, COMMUNITY_AIRDROP, validateCommunityAllocation } from '../airdrop-policy.js';

assert.equal(COMMUNITY_AIRDROP.minimumSupplyPercent, 3);
assert.equal(COMMUNITY_AIRDROP.claimWindowDays, 90);
assert.equal(validateCommunityAllocation(3).valid, true);
assert.equal(validateCommunityAllocation(50).valid, true);
assert.equal(validateCommunityAllocation(2.9).valid, false);
assert.equal(validateCommunityAllocation(50.1).valid, false);

const policy = buildCommunityAirdropPolicy({ allocationPercent: 3, supply: 1_000_000_000 });
assert.equal(policy.reservedTokens, 30_000_000);
assert.equal(policy.eligibility.asset, '$FUNDED');
assert.equal(policy.eligibility.distribution, 'pro-rata');
assert.equal(policy.snapshot.trigger, 'launch-migration');
assert.equal(policy.claim.windowDays, 90);
assert.equal(policy.claim.status, 'opens-after-snapshot-root');
assert.equal(policy.model, 'launch-funded-community-reserve');
assert.equal(policy.reserve.funding, 'same-launch-transaction');
assert.equal(policy.reserve.creatorCanWithdraw, false);
assert.equal(policy.claim.doubleClaimProtection, 'wallet-claim-bitset');
const reservePlan = buildLaunchReservePlan({ allocationPercent: 3, supply: 1_000_000_000, mintAddress: 'demo-mint' });
assert.equal(reservePlan.atomic, true);
assert.equal(reservePlan.reservedTokens, 30_000_000);
assert.deepEqual(reservePlan.instructions, ['create-token', 'fund-community-reserve', 'write-airdrop-policy']);
assert.equal(calculateProRataClaim({ walletBalance: 250, totalEligibleBalance: 10_000, reservedTokens: 30_000_000 }), 750_000);
assert.equal(calculateProRataClaim({ walletBalance: 0, totalEligibleBalance: 10_000, reservedTokens: 30_000_000 }), 0);
assert.equal(calculateProRataClaim({ walletBalance: 10, totalEligibleBalance: 0, reservedTokens: 30_000_000 }), 0);
console.log('community airdrop policy checks passed');
