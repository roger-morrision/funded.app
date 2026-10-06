import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { verifiedCoinRewardsPolicy } from '../coin-rewards-policy.js';

const mint = 'verified-mint';
const makePolicy = () => ({
  mint, cluster:'devnet', onchainVerified:true, policySignature:'verified-signature',
  feeDistribution:buildFeeDistributionPolicy({ creatorWalletPercent:50, holderAirdropPercent:20,
    solClaimPercent:10, xRecipient:'@fundedvip' }),
});

test('verified token policy matches the short creator, holder, and X line on home cards', () => {
  const result = verifiedCoinRewardsPolicy(makePolicy(), mint, 'devnet');
  assert.equal(result.compact, 'Creator 50% · Holders 20% · @fundedvip 10%');
  assert.equal(result.xAccount, '@fundedvip');
  assert.deepEqual(result.protocolPrograms, { operations:14, referrals:3, community:2, buyback:1 });
});

test('unverified, mismatched, or inconsistent policies cannot show a reward split', () => {
  const original = makePolicy();
  assert.equal(verifiedCoinRewardsPolicy(original, 'another-mint', 'devnet'), null);
  assert.equal(verifiedCoinRewardsPolicy(original, mint, 'mainnet-beta'), null);
  for (const change of [
    policy => { policy.onchainVerified = false; },
    policy => { policy.policySignature = ''; },
    policy => { policy.feeDistribution.creatorDirected.shares.holderAirdropPercent = 30; },
    policy => { policy.feeDistribution.fixedFunded.appReferral.effectivePercentOfCreatorFees = 4; },
    policy => { policy.feeDistribution.creatorDirected.recipients.xAccount = '@invalid-handle-too-long'; },
  ]) {
    const policy = structuredClone(original);
    change(policy);
    assert.equal(verifiedCoinRewardsPolicy(policy, mint, 'devnet'), null);
  }
});

test('zero shares are omitted from the compact line', () => {
  const policy = makePolicy();
  policy.feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent:80, holderAirdropPercent:0, solClaimPercent:0 });
  const result = verifiedCoinRewardsPolicy(policy, mint, 'devnet');
  assert.equal(result.compact, 'Creator 80%');
  assert.equal(result.holders, 0);
  assert.equal(result.x, 0);
  policy.feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent:0, holderAirdropPercent:0,
    solClaimPercent:80, xRecipient:'@fundedvip' });
  assert.equal(verifiedCoinRewardsPolicy(policy, mint, 'devnet').compact, '@fundedvip 80%');
});
