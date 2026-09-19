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
    model: 'launch-funded-community-reserve',
    reserve: {
      funding: 'same-launch-transaction',
      purchasePrice: 'launch-price',
      custody: 'community-vault-pda',
      creatorCanWithdraw: false,
      status: 'requires-community-vault-program',
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
      mechanism: 'merkle-proof-from-community-vault',
      windowDays: COMMUNITY_AIRDROP.claimWindowDays,
      status: 'opens-after-snapshot-root',
      doubleClaimProtection: 'wallet-claim-bitset',
      expiredFunds: 'community-growth-reserve',
    },
    safeguards: {
      minimumHoldingPeriodDays: 0,
      maxWalletAllocationPercent: null,
      sybilScreening: 'required-before-root-publication',
      publicReceipts: true,
    },
    productionRequirements: ['community-vault-program', 'holder-indexer', 'merkle-root-publisher'],
  };
}

export function buildLaunchReservePlan({ allocationPercent, supply, mintAddress = null }) {
  const policy = buildCommunityAirdropPolicy({ allocationPercent, supply });
  return {
    ...policy.reserve,
    mint: mintAddress,
    reservedTokens: policy.reservedTokens,
    atomic: true,
    instructions: ['create-token', 'fund-community-reserve', 'write-airdrop-policy'],
    onChainStatus: 'not-deployed-in-frontend',
  };
}

export function calculateProRataClaim({ walletBalance, totalEligibleBalance, reservedTokens }) {
  const wallet = Number(walletBalance);
  const total = Number(totalEligibleBalance);
  const reserve = Number(reservedTokens);
  if (![wallet, total, reserve].every(Number.isFinite) || wallet < 0 || total <= 0 || reserve < 0) return 0;
  return Math.floor(reserve * wallet / total);
}
