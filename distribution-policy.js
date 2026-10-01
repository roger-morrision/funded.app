import { PROTOCOL_FEE_SPLIT } from './config/protocol-fee-split.js';

export function validateProtocolFeeSplit(split = PROTOCOL_FEE_SPLIT) {
  const levels = split?.referralLevelPercents;
  const rates = [split?.operationsPercent, ...(Array.isArray(levels) ? levels : []), split?.communityPercent, split?.buybackPercent];
  if (!Array.isArray(levels) || levels.length !== 3 || rates.some(rate => typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(Math.round(rate * 10_000) - rate * 10_000) > 0.000001)
    || Math.abs(rates.reduce((sum, rate) => sum + rate, 0) - 100) > 0.000001) {
    throw new Error('Protocol fee split must contain operations, three referral levels, community, and buyback percentages totaling 100% of the 20% app share.');
  }
  return {
    operationsPercent: split.operationsPercent,
    referralLevelPercents: [...levels],
    communityPercent: split.communityPercent,
    buybackPercent: split.buybackPercent,
  };
}

const DEFAULT_PROTOCOL_SPLIT = validateProtocolFeeSplit();
const effectivePercent = rate => Number((rate * 0.2).toFixed(6));

export const FEE_DISTRIBUTION = Object.freeze({
  pumpRoutedPercent: 100,
  pumpRoutedShareBps: 10_000,
  fundedPercent: 20,
  creatorPercent: 80,
  operationsRateOfFundedRevenue: DEFAULT_PROTOCOL_SPLIT.operationsPercent,
  operationsEffectivePercent: effectivePercent(DEFAULT_PROTOCOL_SPLIT.operationsPercent),
  appReferralRateOfFundedRevenue: DEFAULT_PROTOCOL_SPLIT.referralLevelPercents.reduce((sum, rate) => sum + rate, 0),
  appReferralEffectivePercent: effectivePercent(DEFAULT_PROTOCOL_SPLIT.referralLevelPercents.reduce((sum, rate) => sum + rate, 0)),
  communityRateOfFundedRevenue: DEFAULT_PROTOCOL_SPLIT.communityPercent,
  communityEffectivePercent: effectivePercent(DEFAULT_PROTOCOL_SPLIT.communityPercent),
  buybackRateOfFundedRevenue: DEFAULT_PROTOCOL_SPLIT.buybackPercent,
  buybackEffectivePercent: effectivePercent(DEFAULT_PROTOCOL_SPLIT.buybackPercent),
});

const REFERRAL_RELATIONSHIPS = ['direct-inviter', 'inviter-upline', 'second-upline'];
const referralLevelsFor = split => split.referralLevelPercents.map((rate, index) => ({
  level: index + 1,
  relationship: REFERRAL_RELATIONSHIPS[index],
  percentOfFundedRevenue: rate,
  effectivePercentOfCreatorFees: effectivePercent(rate),
}));
export const APP_REFERRAL_LEVELS = Object.freeze(referralLevelsFor(DEFAULT_PROTOCOL_SPLIT).map(level => Object.freeze(level)));

function splitFromSnapshot(fixedFunded) {
  if (!fixedFunded) return DEFAULT_PROTOCOL_SPLIT;
  if (Number(fixedFunded.percent) !== FEE_DISTRIBUTION.fundedPercent) throw new Error('Launch fee policy must preserve the 20% app share.');
  return validateProtocolFeeSplit({
    operationsPercent: fixedFunded.operations?.percentOfFundedRevenue,
    referralLevelPercents: fixedFunded.appReferral?.levels?.map(level => level.percentOfFundedRevenue),
    communityPercent: fixedFunded.communityRewards?.percentOfFundedRevenue,
    buybackPercent: fixedFunded.fundedBuyback?.percentOfFundedRevenue,
  });
}

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

export function buildFeeDistributionPolicy(input = {}, { fundedSplit = DEFAULT_PROTOCOL_SPLIT } = {}) {
  const result = validateFeeDistribution(input);
  if (!result.valid) throw new Error('Creator fee shares must total exactly 80%, with a valid X recipient when enabled.');
  const split = validateProtocolFeeSplit(fundedSplit);
  const referralLevels = referralLevelsFor(split);
  const referralPercent = split.referralLevelPercents.reduce((sum, rate) => sum + rate, 0);
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
        percentOfFundedRevenue: split.operationsPercent,
        effectivePercentOfCreatorFees: effectivePercent(split.operationsPercent),
      },
      appReferral: {
        percentOfFundedRevenue: referralPercent,
        effectivePercentOfCreatorFees: effectivePercent(referralPercent),
        maxDepth: referralLevels.length,
        levels: referralLevels,
        basis: 'funded-app-revenue-from-invited-guest-creators',
        qualification: 'collected-revenue-only-no-recruitment-bounty',
        attribution: 'account-level-first-touch',
        uplineResolution: 'server-referral-graph-at-first-qualified-event',
        safeguards: ['reject-self-referral', 'reject-repeated-account-in-chain', 'lock-upline-after-first-qualified-event'],
        unattributedDestination: 'community-growth-reserve',
      },
      communityRewards: {
        percentOfFundedRevenue: split.communityPercent,
        effectivePercentOfCreatorFees: effectivePercent(split.communityPercent),
        destination: 'community-program-reserve',
        use: 'future-published-community-programs',
        payoutMode: 'disabled-until-program-rules-and-verified-receipts',
      },
      fundedBuyback: {
        percentOfFundedRevenue: split.buybackPercent,
        effectivePercentOfCreatorFees: effectivePercent(split.buybackPercent),
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

function allocateLamports(gross, percentages) {
  const lamports = Math.round(gross * 1_000_000_000);
  if (!Number.isSafeInteger(lamports)) throw new Error('Gross creator fees exceed the safe lamport accounting range.');
  const rateTotal = percentages.reduce((sum, rate) => sum + rate, 0);
  const exact = percentages.map(rate => lamports * rate / rateTotal);
  const amounts = exact.map(Math.floor);
  const remaining = lamports - amounts.reduce((sum, amount) => sum + amount, 0);
  const order = exact.map((amount, index) => index).sort((a, b) => (exact[b] - amounts[b]) - (exact[a] - amounts[a]) || percentages[b] - percentages[a] || a - b);
  for (let index = 0; index < remaining; index++) amounts[order[index]]++;
  return amounts.map(amount => amount / 1_000_000_000);
}

export function calculateCreatorFeeClaim(grossCreatorFees, input = {}, { referralRecipients = [], fixedFunded = null } = {}) {
  const gross = Number(grossCreatorFees);
  if (!Number.isFinite(gross) || gross < 0) throw new Error('Gross creator fees must be a non-negative number.');
  const validation = validateFeeDistribution(input);
  if (!validation.valid) throw new Error('Creator fee shares must total exactly 80%, with a valid X recipient when enabled.');
  const split = splitFromSnapshot(fixedFunded);

  const levelDefinitions = referralLevelsFor(split);
  const [creatorWallet, holderAirdrop, solClaim, operations, communityBase, buyback, ...referralAmounts] = allocateLamports(gross, [
    validation.shares.creatorWalletPercent, validation.shares.holderAirdropPercent, validation.shares.solClaimPercent,
    effectivePercent(split.operationsPercent), effectivePercent(split.communityPercent), effectivePercent(split.buybackPercent),
    ...levelDefinitions.map(level => level.effectivePercentOfCreatorFees),
  ]);
  const creatorDestinations = { creatorWallet, holderAirdrop, solClaim };
  const referralLevels = levelDefinitions.map((level, index) => {
    const amount = referralAmounts[index];
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
  if (Math.round(totalAllocated * 1_000_000_000) !== Math.round(gross * 1_000_000_000)) throw new Error('Creator-fee settlement must allocate every claimed lamport exactly once.');

  return {
    grossCreatorFees: roundAmount(gross),
    pumpRouterIngress: roundAmount(gross),
    creatorDestinations,
    creatorTotal,
    fundedApp: {
      total: roundAmount(operations + referralPayout + community + buyback),
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
