import test from 'node:test';
import assert from 'node:assert/strict';
import { v3AutomaticRewardStatus } from '../server/v3-automatic-status.mjs';

test('public automatic status excludes historical V2 schedules and claims only V3 evidence', () => {
  const state = {
    launches: {
      v2: { mint:'v2', cluster:'devnet', onchainVerified:true,
        pumpFeeRoute:{ scope:'per-mint-v2', verified:true } },
      v3: { mint:'v3', cluster:'devnet', onchainVerified:true,
        pumpFeeRoute:{ scope:'per-mint-v3', verified:true } },
    },
    v3CreatorRewardFunding: { source:{ status:'finalized' } },
  };
  const rewards = { schedules: {
    old: { id:'old', mint:'v2', kind:'holder', asset:'SOL', periodStart:1,
      cutoffAt:2, payoutAt:3, status:'paid', poolIds:['old'] },
    current: { id:'current', mint:'v3', kind:'holder', asset:'SOL', periodStart:1,
      cutoffAt:2, payoutAt:3, status:'paid', poolIds:['v3:source'] },
  } };
  const status = v3AutomaticRewardStatus(state, rewards, new Date('2026-10-13T00:00:00Z'));
  assert.equal(status.scope, 'per-mint-v3');
  assert.deepEqual(status.schedules.map(row => row.id), ['current']);
  assert.equal(status.modes.holders, 'v3-holder-payout-recorded');
  assert.equal(status.modes.creator, 'v3-creator-wallet-payout-pending');
  assert.equal(status.modes.referrals, 'v3-referral-payout-pending');
  assert.equal(status.modes.community, 'v3-community-claim-unverified');
});

test('finalized QA community payments remain distinct from real migration claim readiness', () => {
  const state = { launches:{ qa:{ mint:'qa', cluster:'devnet', onchainVerified:true,
    pumpFeeRoute:{ scope:'per-mint-v3', verified:true } } } };
  const rewards = { communityDrops:{ qa:{ snapshotBasis:'devnet-qa-cutoff' } },
    communityClaimIndex:{ status:'verified', drops:[{ mint:'qa', claimCount:1,
      claimedBaseUnits:'100' }] } };
  assert.equal(v3AutomaticRewardStatus(state, rewards).modes.community,
    'v3-community-qa-claim-recorded');
  rewards.communityDrops.qa.snapshotBasis = 'pump-migration';
  assert.equal(v3AutomaticRewardStatus(state, rewards).modes.community,
    'verified-token-airdrop-cycle');
});
