export const COMMUNITY_AIRDROP = Object.freeze({
  minimumSupplyPercent: 3,
  maximumSupplyPercent: 50,
  claimWindowDays: 90,
  snapshotTrigger: 'launch-migration',
  eligibilityAsset: '$FUNDED',
});

export function validateCommunityAllocation(value) {
  const allocationPercent = Number(value);
  return {
    valid: Number.isFinite(allocationPercent)
      && allocationPercent >= COMMUNITY_AIRDROP.minimumSupplyPercent
      && allocationPercent <= COMMUNITY_AIRDROP.maximumSupplyPercent,
    allocationPercent,
  };
}

export function buildCommunityAirdropPolicy({ allocationPercent, supply }) {
  const allocation = validateCommunityAllocation(allocationPercent);
  const normalizedSupply = Number(supply);
  if (!allocation.valid) throw new Error('Community allocation must be between 3% and 50%.');
  if (!Number.isSafeInteger(normalizedSupply) || normalizedSupply < 1) throw new Error('Airdrop supply must be a positive safe integer.');
  return {
    model: 'community-allocation-pending-funding',
    reserve: {
      funding: 'verified-post-launch-transfer-required',
      purchasePrice: null,
      custody: 'reward-vault-pda-after-funding',
      creatorCanWithdraw: null,
      status: 'funding-unverified',
    },
    allocationPercent: allocation.allocationPercent,
    reservedTokens: Math.floor(normalizedSupply * allocation.allocationPercent / 100),
    eligibility: {
      asset: COMMUNITY_AIRDROP.eligibilityAsset,
      rule: 'holder-balance-at-migration-snapshot',
      distribution: 'pro-rata',
    },
    snapshot: {
      trigger: COMMUNITY_AIRDROP.snapshotTrigger,
      status: 'pending-migration',
    },
    claim: {
      mechanism: 'merkle-proof-from-funded-community-vault',
      windowDays: COMMUNITY_AIRDROP.claimWindowDays,
      status: 'requires-funded-vault-and-migration-snapshot',
      doubleClaimProtection: 'recipient-payment-pda',
      expiredFunds: 'app-owner-reward-authority-wallet',
    },
    safeguards: {
      minimumHoldingPeriodDays: 0,
      maxWalletAllocationPercent: null,
      sybilScreening: 'not-implemented',
      publicReceipts: true,
    },
    productionRequirements: ['same-launch-reserve-funding', 'migration-time-holder-snapshot', 'claim-proof-publisher', 'verified-app-owner-reward-authority'],
  };
}

export function buildLaunchReservePlan({ allocationPercent, supply, mintAddress = null }) {
  const policy = buildCommunityAirdropPolicy({ allocationPercent, supply });
  return {
    ...policy.reserve,
    mint: mintAddress,
    reservedTokens: policy.reservedTokens,
    atomic: false,
    instructions: [],
    onChainStatus: 'funding-not-in-launch-transaction',
  };
}

export function calculateProRataClaim({ walletBalance, totalEligibleBalance, reservedTokens }) {
  const wallet = Number(walletBalance);
  const total = Number(totalEligibleBalance);
  const reserve = Number(reservedTokens);
  if (![wallet, total, reserve].every(Number.isFinite) || wallet < 0 || total <= 0 || reserve < 0) return 0;
  return Math.floor(reserve * wallet / total);
}
