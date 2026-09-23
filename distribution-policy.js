export const FEE_DISTRIBUTION = Object.freeze({
  pumpRoutedPercent: 100,
  pumpRoutedShareBps: 10_000,
  fundedPercent: 20,
  creatorPercent: 80,
  operationsRateOfFundedRevenue: 70,
  operationsEffectivePercent: 14,
  appReferralRateOfFundedRevenue: 15,
  appReferralEffectivePercent: 3,
  communityRateOfFundedRevenue: 10,
  communityEffectivePercent: 2,
  buybackRateOfFundedRevenue: 5,
  buybackEffectivePercent: 1,
});

export const APP_REFERRAL_LEVELS = Object.freeze([
  Object.freeze({ level: 1, relationship: 'direct-inviter', percentOfFundedRevenue: 10, effectivePercentOfCreatorFees: 2 }),
  Object.freeze({ level: 2, relationship: 'inviter-upline', percentOfFundedRevenue: 3, effectivePercentOfCreatorFees: 0.6 }),
  Object.freeze({ level: 3, relationship: 'second-upline', percentOfFundedRevenue: 2, effectivePercentOfCreatorFees: 0.4 }),
]);

const X_HANDLE_PATTERN = /^@[A-Za-z0-9_]{1,15}$/;

export function readFeeShares(input = {}) {
  return {
    creatorWalletPercent: Number(input.creatorWalletPercent) || 0,
    holderAirdropPercent: Number(input.holderAirdropPercent) || 0,
    solClaimPercent: Number(input.solClaimPercent ?? input.xPercent) || 0,
  };
}

export function validateFeeDistribution(input = {}) {
  const shares = readFeeShares(input);
  const valuesValid = Object.values(shares).every(value => Number.isFinite(value) && value >= 0 && value <= FEE_DISTRIBUTION.creatorPercent);
  const total = shares.creatorWalletPercent + shares.holderAirdropPercent + shares.solClaimPercent;
  const xRecipient = String(input.xRecipient || '').trim();
  const xRecipientValid = shares.solClaimPercent === 0 || X_HANDLE_PATTERN.test(xRecipient);
  return {
    valid: valuesValid && Math.abs(total - FEE_DISTRIBUTION.creatorPercent) < 0.001 && xRecipientValid,
    sharesValid: valuesValid,
    shares,
    total,
    remaining: FEE_DISTRIBUTION.creatorPercent - total,
    xRecipientValid,
  };
}

export function buildFeeDistributionPolicy(input = {}) {
  const result = validateFeeDistribution(input);
  if (!result.valid) throw new Error('Creator fee shares must total exactly 80%, with a valid X recipient when enabled.');
  return {
    pumpCreatorFeeRoute: {
      percent: FEE_DISTRIBUTION.pumpRoutedPercent,
      shareBps: FEE_DISTRIBUTION.pumpRoutedShareBps,
      recipient: 'funded-app-fee-router-pda',
      routerAddress: input.feeRouterAddress || null,
      setup: 'pump-create-v2-creator-is-router-pda',
      userRole: 'payer-not-creator-fee-authority',
      authorityRule: 'creator-wallet-never-receives-pump-fee-authority',
      activationGate: 'bonding-curve-creator-equals-verified-router-pda',
    },
    fixedFunded: {
      percent: FEE_DISTRIBUTION.fundedPercent,
      operations: {
        percentOfFundedRevenue: FEE_DISTRIBUTION.operationsRateOfFundedRevenue,
        effectivePercentOfCreatorFees: FEE_DISTRIBUTION.operationsEffectivePercent,
      },
      appReferral: {
        percentOfFundedRevenue: FEE_DISTRIBUTION.appReferralRateOfFundedRevenue,
        effectivePercentOfCreatorFees: FEE_DISTRIBUTION.appReferralEffectivePercent,
        maxDepth: APP_REFERRAL_LEVELS.length,
        levels: APP_REFERRAL_LEVELS,
        basis: 'funded-app-revenue-from-invited-guest-creators',
        qualification: 'collected-revenue-only-no-recruitment-bounty',
        attribution: 'account-level-first-touch',
        uplineResolution: 'server-referral-graph-at-first-qualified-event',
        safeguards: ['reject-self-referral', 'reject-repeated-account-in-chain', 'lock-upline-after-first-qualified-event'],
        unattributedDestination: 'community-growth-reserve',
      },
      communityRewards: {
        percentOfFundedRevenue: FEE_DISTRIBUTION.communityRateOfFundedRevenue,
        effectivePercentOfCreatorFees: FEE_DISTRIBUTION.communityEffectivePercent,
      },
      fundedBuyback: {
        percentOfFundedRevenue: FEE_DISTRIBUTION.buybackRateOfFundedRevenue,
        effectivePercentOfCreatorFees: FEE_DISTRIBUTION.buybackEffectivePercent,
        action: 'buyback-and-burn',
        allocationTiming: 'when-creator-fees-are-actually-claimed',
        vault: 'dedicated-buyback-pda',
        burnInstruction: 'BurnChecked',
        failedExecutionRule: 'keep-pending-never-reroute',
      },
      status: 'policy-defined-settlement-requires-verified-receipts',
    },
    creatorDirected: {
      percent: FEE_DISTRIBUTION.creatorPercent,
      shares: result.shares,
      recipients: {
        creatorWallet: 'connected-creator-wallet',
        holderAirdrop: result.shares.holderAirdropPercent > 0 ? 'holder-rewards-vault' : null,
        xAccount: result.shares.solClaimPercent > 0 ? String(input.xRecipient).trim() : null,
        solClaimMode: result.shares.solClaimPercent > 0 ? 'x-handle-wallet-verification' : null,
        xPayoutMode: null,
      },
      status: 'policy-defined-settlement-requires-verified-receipts',
    },
    settlement: {
      source: 'creator-fees-actually-claimed-by-funded-app-router',
      idempotencyKey: 'pump-fee-claim-transaction-signature',
      accountingRule: 'create-all-obligations-before-any-payout',
      failureRule: 'retain-pending-obligation-never-reallocate',
    },
    immutable: true,
  };
}

function roundAmount(value) {
  return Number(Number(value).toFixed(9));
}

export function calculateCreatorFeeClaim(grossCreatorFees, input = {}, { referralRecipients = [] } = {}) {
  const gross = Number(grossCreatorFees);
  if (!Number.isFinite(gross) || gross < 0) throw new Error('Gross creator fees must be a non-negative number.');
  const validation = validateFeeDistribution(input);
  if (!validation.valid) throw new Error('Creator fee shares must total exactly 80%, with a valid X recipient when enabled.');

  const creatorDestinations = {
    creatorWallet: roundAmount(gross * validation.shares.creatorWalletPercent / 100),
    holderAirdrop: roundAmount(gross * validation.shares.holderAirdropPercent / 100),
    solClaim: roundAmount(gross * validation.shares.solClaimPercent / 100),
  };
  const operations = roundAmount(gross * FEE_DISTRIBUTION.operationsEffectivePercent / 100);
  const buyback = roundAmount(gross * FEE_DISTRIBUTION.buybackEffectivePercent / 100);
  const communityBase = roundAmount(gross * FEE_DISTRIBUTION.communityEffectivePercent / 100);
  const referralLevels = APP_REFERRAL_LEVELS.map((level, index) => {
    const amount = roundAmount(gross * level.effectivePercentOfCreatorFees / 100);
    return {
      level: level.level,
      recipient: referralRecipients[index] || null,
      amount,
      status: referralRecipients[index] ? 'claimable' : 'redirected-to-community-growth-reserve',
      payoutMode: referralRecipients[index] ? 'user-initiated-wallet-claim' : null,
    };
  });
  const referralPayout = roundAmount(referralLevels.filter(level => level.recipient).reduce((sum, level) => sum + level.amount, 0));
  const missingReferral = roundAmount(referralLevels.filter(level => !level.recipient).reduce((sum, level) => sum + level.amount, 0));
  const community = roundAmount(communityBase + missingReferral);
  const creatorTotal = roundAmount(Object.values(creatorDestinations).reduce((sum, amount) => sum + amount, 0));
  const totalAllocated = roundAmount(creatorTotal + operations + referralPayout + community + buyback);
  if (Math.abs(totalAllocated - gross) > 0.000001) throw new Error('Creator-fee settlement must allocate exactly 100% of the claimed amount.');

  return {
    grossCreatorFees: roundAmount(gross),
    pumpRouterIngress: roundAmount(gross),
    creatorDestinations,
    creatorTotal,
    fundedApp: {
      total: roundAmount(gross * FEE_DISTRIBUTION.fundedPercent / 100),
      operations,
      referralLevels,
      referralPayout,
      communityBase,
      missingReferralToCommunity: missingReferral,
      community,
      buyback,
    },
    totalAllocated,
    status: 'obligations-created',
  };
}

export function settleCreatorFeeClaim(event, input = {}, options = {}, settledClaims = new Map()) {
  const claimSignature = String(event?.claimSignature || '').trim();
  if (!claimSignature) throw new Error('A Pump fee-claim transaction signature is required.');
  if (settledClaims.has(claimSignature)) return settledClaims.get(claimSignature);
  const settlement = {
    claimSignature,
    claimedAt: event.claimedAt || new Date().toISOString(),
    asset: String(event.asset || 'SOL').toUpperCase(),
    ...calculateCreatorFeeClaim(event.grossCreatorFees, input, options),
  };
  settledClaims.set(claimSignature, settlement);
  return settlement;
}
