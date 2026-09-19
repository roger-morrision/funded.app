const DEFAULT_BOOST_AMOUNT = 25_000;
const DEFAULT_PRO_AMOUNT = 100_000;
const DEFAULT_PREMIER_AMOUNT = 250_000;

function positiveInteger(value, fallback) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : fallback;
}

export function createLaunchBurnTiers({
  boostAmount = DEFAULT_BOOST_AMOUNT,
  proAmount = DEFAULT_PRO_AMOUNT,
  premierAmount = DEFAULT_PREMIER_AMOUNT,
} = {}) {
  const boost = positiveInteger(boostAmount, DEFAULT_BOOST_AMOUNT);
  const pro = positiveInteger(proAmount, DEFAULT_PRO_AMOUNT);
  const premier = positiveInteger(premierAmount, DEFAULT_PREMIER_AMOUNT);
  if (pro <= boost) throw new Error('The Pro burn amount must be greater than the Boost burn amount.');
  if (premier <= pro) throw new Error('The Premier burn amount must be greater than the Pro burn amount.');
  return Object.freeze([
    Object.freeze({
      id: 'standard',
      label: 'Standard',
      amountTokens: 0,
      tone: 'standard',
      benefits: Object.freeze(['Core Pump launch', 'Community airdrop', 'Published fee route']),
    }),
    Object.freeze({
      id: 'boost',
      label: 'Boost',
      amountTokens: boost,
      tone: 'boost',
      benefits: Object.freeze(['Verified Boost badge', 'Boost directory filter', 'Public burn receipt']),
    }),
    Object.freeze({
      id: 'pro',
      label: 'Pro',
      amountTokens: pro,
      tone: 'pro',
      benefits: Object.freeze(['Verified Pro badge', 'All Boost benefits', 'Featured-review eligibility']),
    }),
    Object.freeze({
      id: 'premier',
      label: 'Premier',
      amountTokens: premier,
      tone: 'premier',
      benefits: Object.freeze(['Verified Premier badge', 'All Pro benefits', 'Homepage spotlight-review eligibility']),
    }),
  ]);
}

export const LAUNCH_BURN_POLICY_VERSION = 1;
export const LAUNCH_BURN_TIERS = createLaunchBurnTiers();

export function findLaunchBurnTier(tierId, tiers = LAUNCH_BURN_TIERS) {
  const id = String(tierId || 'standard').trim().toLowerCase();
  const tier = tiers.find(item => item.id === id);
  if (!tier) throw new Error(`Unknown launch burn tier: ${id}`);
  return tier;
}

export function buildLaunchBurnPolicy({ tierId = 'standard', fundedMint = null, tiers = LAUNCH_BURN_TIERS } = {}) {
  const tier = findLaunchBurnTier(tierId, tiers);
  const mint = String(fundedMint || '').trim() || null;
  const requiresBurn = tier.amountTokens > 0;
  return {
    version: LAUNCH_BURN_POLICY_VERSION,
    tier: tier.id,
    label: tier.label,
    amountTokens: tier.amountTokens,
    fundedMint: mint,
    requiresBurn,
    instruction: requiresBurn ? 'BurnChecked' : null,
    atomicWithPumpLaunch: requiresBurn,
    benefits: [...tier.benefits],
    featuredPlacementGuaranteed: false,
    separateFromRevenueBuyback: true,
    status: requiresBurn ? (mint ? 'configured-awaiting-wallet-check' : 'blocked-mint-not-configured') : 'no-burn-required',
  };
}

export function validateLaunchBurnPolicy(policy) {
  if (!policy || !findLaunchBurnTier(policy.tier)) return { valid: false, reason: 'invalid-tier' };
  if (!policy.requiresBurn) return { valid: true, reason: 'no-burn-required' };
  if (!policy.fundedMint) return { valid: false, reason: 'funded-mint-required' };
  if (!Number.isSafeInteger(policy.amountTokens) || policy.amountTokens <= 0) return { valid: false, reason: 'invalid-burn-amount' };
  return { valid: true, reason: 'configured' };
}

export function tokensToBaseUnits(amountTokens, decimals) {
  if (!Number.isSafeInteger(amountTokens) || amountTokens < 0) throw new Error('Burn amount must be a non-negative safe integer.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Mint decimals must be between 0 and 18.');
  return BigInt(amountTokens) * (10n ** BigInt(decimals));
}
