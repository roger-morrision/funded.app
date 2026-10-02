import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCommunityAirdropPolicy, buildLaunchReservePlan, calculateProRataClaim, COMMUNITY_AIRDROP, validateCommunityAllocation, fundedCommunityAirdropPolicy } from '../airdrop-policy.js';

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
assert.equal(policy.claim.expiredFunds, 'app-owner-reward-authority-wallet');
assert.equal(policy.claim.status, 'requires-funded-vault-and-migration-snapshot');
assert.equal(policy.model, 'community-allocation-pending-funding');
assert.equal(policy.reserve.funding, 'verified-post-launch-transfer-required');
assert.equal(policy.reserve.creatorCanWithdraw, null);
assert.equal(policy.claim.doubleClaimProtection, 'recipient-payment-pda');
const reservePlan = buildLaunchReservePlan({ allocationPercent: 3, supply: 1_000_000_000, mintAddress: 'demo-mint' });
assert.equal(reservePlan.atomic, false);
assert.equal(reservePlan.reservedTokens, 30_000_000);
assert.deepEqual(reservePlan.instructions, []);
const funded = fundedCommunityAirdropPolicy({ allocationPercent:3, supply:1_000_000_000,
  receipt:{ atomic:true, signature:'finalized-launch-signature', vault:'reward-vault-pda', fundedTokens:30_000_000 } });
assert.equal(funded.reserve.status, 'funded');
assert.equal(funded.reserve.creatorCanWithdraw, false);
assert.equal(funded.claim.status, 'requires-migration-snapshot-and-published-claims');
assert.throws(() => fundedCommunityAirdropPolicy({ allocationPercent:3, supply:1_000_000_000,
  receipt:{ atomic:true, signature:'finalized-launch-signature', vault:'reward-vault-pda', fundedTokens:29_999_999 } }));
assert.equal(calculateProRataClaim({ walletBalance: 250, totalEligibleBalance: 10_000, reservedTokens: 30_000_000 }), 750_000);
assert.equal(calculateProRataClaim({ walletBalance: 0, totalEligibleBalance: 10_000, reservedTokens: 30_000_000 }), 0);
assert.equal(calculateProRataClaim({ walletBalance: 10, totalEligibleBalance: 0, reservedTokens: 30_000_000 }), 0);
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(appSource, /communityClaimWindow\.disabled = true/, 'The fixed claim window must not appear editable.');
assert.match(appSource, /Fixed at 90 days after migration\./, 'The fixed claim window needs an explicit explanation.');
assert.match(appSource, /BigInt\(reserve\.claimedBaseUnits\) \* BigInt\(reservedTokens\) \* 1_000_000n \/ BigInt\(reserve\.totalBaseUnits\)/, 'Claimed token display must retain six-decimal precision.');
assert.match(appSource, /const claimPrograms = programs\.filter\(item => item\.claimPublished && item\.claimedTokens != null && item\.vaultVerified === true[\s\S]*?Indexed claim state for \$\{claimPrograms\.length\}\/\$\{programs\.length\} programs/, 'Airdrop summary must show partial indexed claim coverage instead of hiding all claims.');
console.log('community airdrop policy checks passed');
