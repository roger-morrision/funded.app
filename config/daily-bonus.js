// One completed UTC day. Each category receives one third of the base community
// allocation; unfilled ranks keep their portion in the source reward vault.
export const DAILY_BONUS_POLICY = Object.freeze({
  version: 1,
  periodSeconds: 86_400,
  timezone: 'UTC',
  categories: Object.freeze(['creators', 'referrals', 'traders']),
  categoryWeights: Object.freeze([1, 1, 1]),
  rankPercents: Object.freeze([50, 30, 20]),
  metrics: Object.freeze({ creators: 'collected-creator-fee-lamports',
    referrals: 'direct-referred-collected-fee-lamports', traders: 'finalized-trading-volume-lamports' }),
  tieBreak: 'wallet-address-ascending',
  unfilledRank: 'retain-in-community-vault',
});
