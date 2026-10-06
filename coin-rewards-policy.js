const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const matches = (value, expected) => value !== null && Math.abs(value - expected) < 0.000001;

export const formatPolicyPercent = value => `${Number(value.toFixed(2))}%`;

export function verifiedCoinRewardsPolicy(policy, mint, cluster) {
  if (!policy || policy.mint !== mint || policy.cluster !== cluster || policy.onchainVerified !== true
    || typeof policy.policySignature !== 'string' || !policy.policySignature.trim()) return null;

  const distribution = policy.feeDistribution;
  const creator = percent(distribution?.creatorDirected?.shares?.creatorWalletPercent);
  const holders = percent(distribution?.creatorDirected?.shares?.holderAirdropPercent);
  const x = percent(distribution?.creatorDirected?.shares?.solClaimPercent);
  const protocol = percent(distribution?.fixedFunded?.percent);
  if (creator === null || holders === null || x === null || !matches(protocol, 20)
    || !matches(percent(distribution?.creatorDirected?.percent), 80)
    || !matches(percent(distribution?.pumpCreatorFeeRoute?.percent), 100)
    || !matches(creator + holders + x, 80)) return null;

  const xAccount = distribution.creatorDirected.recipients?.xAccount;
  if (x > 0 && (typeof xAccount !== 'string' || !/^@[A-Za-z0-9_]{1,15}$/.test(xAccount))) return null;

  const protocolPrograms = {
    operations: percent(distribution.fixedFunded.operations?.effectivePercentOfCreatorFees),
    referrals: percent(distribution.fixedFunded.appReferral?.effectivePercentOfCreatorFees),
    community: percent(distribution.fixedFunded.communityRewards?.effectivePercentOfCreatorFees),
    buyback: percent(distribution.fixedFunded.fundedBuyback?.effectivePercentOfCreatorFees),
  };
  if (Object.values(protocolPrograms).some(value => value === null)
    || !matches(Object.values(protocolPrograms).reduce((sum, value) => sum + value, 0), protocol)) return null;

  const compact = [
    creator > 0 ? `Creator ${formatPolicyPercent(creator)}` : null,
    holders > 0 ? `Holders ${formatPolicyPercent(holders)}` : null,
    x > 0 ? `${xAccount} ${formatPolicyPercent(x)}` : null,
  ].filter(Boolean).join(' · ');
  return { creator, holders, x, protocol, xAccount: x > 0 ? xAccount : null, protocolPrograms, compact };
}
