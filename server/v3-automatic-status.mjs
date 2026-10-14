import { automaticRewardStatus } from './automatic-rewards.mjs';

// The automatic ledger predates V3. Only schedules belonging to a verified V3
// launch may appear in the public status, even if old records survive a reset.
export function v3AutomaticRewardStatus(state = {}, rewards = {}, now = new Date()) {
  const launches = state.launches || {};
  const allowedMints = new Set(Object.values(launches)
    .filter(row => row?.cluster === 'devnet' && row.onchainVerified === true
      && row.pumpFeeRoute?.scope === 'per-mint-v3'
      && row.pumpFeeRoute?.verified === true)
    .map(row => row.mint));
  const schedules = Object.fromEntries(Object.entries(rewards.schedules || {})
    .filter(([, row]) => allowedMints.has(row?.mint) && row.kind === 'holder'
      && row.asset === 'SOL'));
  const status = automaticRewardStatus(now, { ...rewards, schedules });
  const paidHolder = Object.values(schedules).some(row => row.status === 'paid'
    && (row.poolIds || []).some(id => id.startsWith('v3:')
      && state.v3CreatorRewardFunding?.[id.slice(3)]?.status === 'finalized'));
  const creatorPaid = Object.values(state.v3CreatorWalletPayout || {}).some(row =>
    row.status === 'finalized' && row.balanceDeltaVerified === true
    && allowedMints.has(row.mint));
  status.scope = 'per-mint-v3';
  status.modes.creator = creatorPaid ? 'v3-creator-wallet-payout-recorded'
    : 'v3-creator-wallet-payout-pending';
  status.modes.holders = paidHolder ? 'v3-holder-payout-recorded'
    : 'v3-holder-payout-pending';
  const indexed = rewards.communityClaimIndex?.status === 'verified'
    ? rewards.communityClaimIndex : null;
  const paidDrops = (indexed?.drops || []).filter(row => allowedMints.has(row.mint)
    && Number(row.claimCount) > 0 && BigInt(row.claimedBaseUnits || '0') > 0n);
  status.modes.community = paidDrops.some(row =>
    rewards.communityDrops?.[row.mint]?.snapshotBasis === 'pump-migration')
    ? 'verified-token-airdrop-cycle'
    : paidDrops.some(row => rewards.communityDrops?.[row.mint]?.snapshotBasis === 'devnet-qa-cutoff')
      ? 'v3-community-qa-claim-recorded' : 'v3-community-claim-unverified';
  status.modes.referrals = Object.values(state.v3ReferralPayouts || {}).some(row =>
    row.status === 'finalized' && row.balanceDeltaVerified === true
    && row.signature && allowedMints.has(row.mint))
    ? 'v3-referral-payout-recorded' : 'v3-referral-payout-pending';
  return status;
}
