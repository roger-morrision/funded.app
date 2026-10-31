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
  const fixed = makePolicy().feeDistribution.fixedFunded;
  assert.deepEqual(result.protocolPrograms, {
    operations: fixed.operations.effectivePercentOfCreatorFees,
    referrals: fixed.appReferral.effectivePercentOfCreatorFees,
    community: fixed.communityRewards.effectivePercentOfCreatorFees,
    buyback: fixed.fundedBuyback.effectivePercentOfCreatorFees,
  });
});

test('unverified, mismatched, or inconsistent policies cannot show a reward split', () => {
  const original = makePolicy();
  assert.equal(verifiedCoinRewardsPolicy(original, 'another-mint', 'devnet'), null);
  assert.equal(verifiedCoinRewardsPolicy(original, mint, 'mainnet-beta'), null);
  for (const change of [
    policy => { policy.onchainVerified = false; },
    policy => { policy.policySignature = ''; },
    policy => { policy.feeDistribution.creatorDirected.shares.holderAirdropPercent = 30; },
    policy => { policy.feeDistribution.fixedFunded.appReferral.effectivePercentOfCreatorFees += 1; },
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


test('small configured holder percentages remain visible in the saved token policy', () => {
  const policy = makePolicy();
  policy.feeDistribution = buildFeeDistributionPolicy({ creatorWalletPercent:79.9989,
    holderAirdropPercent:0.0011, solClaimPercent:0 });
  assert.equal(verifiedCoinRewardsPolicy(policy, mint, 'devnet').compact,
    'Creator 79.9989% · Holders 0.0011%');
});

test('the published 1% referral and 2% agency policy keeps a valid coin allocation visible',()=>{
  const policy=makePolicy();policy.feeDistribution=buildFeeDistributionPolicy({creatorWalletPercent:50,holderAirdropPercent:20,solClaimPercent:10,xRecipient:'@fundedvip'},{fundedSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,0.75],communityPercent:20,buybackPercent:25,agencyPercent:10}});
  const result=verifiedCoinRewardsPolicy(policy,mint,'devnet');assert.equal(result.compact,'Creator 50% · Holders 20% · @fundedvip 10%');
  assert.deepEqual(result.protocolPrograms,{operations:8,referrals:1,community:4,buyback:5,agency:2});
  for(const value of[1,null,'2',NaN]){const bad=structuredClone(policy);bad.feeDistribution.fixedFunded.marketingAgency.effectivePercentOfCreatorFees=value;assert.equal(verifiedCoinRewardsPolicy(bad,mint,'devnet'),null);}
  delete policy.feeDistribution.fixedFunded.marketingAgency;assert.equal(verifiedCoinRewardsPolicy(policy,mint,'devnet'),null);
});
