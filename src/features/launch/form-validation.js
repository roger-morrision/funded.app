import { getPreparedImage, assertImageReady } from '../../../launch-image.js';
import { normalizeXProfileInput } from '../../../launch-social-url.js';
import { validateFeeDistribution } from '../../../distribution-policy.js';
import { validateLaunchBurnPolicy } from '../../../launch-burn-policy.js';
import { canSignTransactions } from '../../../wallet-core.js';
import { freshLaunchReview } from '../../../launch-review.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function getLaunchMetadataPreview(
  {},
  {
    document = globalThis.document,
  } = {}
) {
  const image = getPreparedImage();
  return {
    description: document.querySelector('#token-description')?.value.trim() || '',
    tagline: document.querySelector('#token-tagline')?.value.trim() || '',
    roadmap: document.querySelector('#token-roadmap')?.value.trim() || '',
    website: document.querySelector('#token-website')?.value.trim() || '',
    x: normalizeXProfileInput(document.querySelector('#token-x')?.value),
    telegram: document.querySelector('#token-telegram')?.value.trim() || '',
    discord: document.querySelector('#token-discord')?.value.trim() || '',
    imageName: image?.name || '',
    imageType: image?.type || '',
  };
}

export function getLaunchStepState(
  step,
  {
    MIN_COMMUNITY_AIRDROP_TOKENS,
    MAX_COMMUNITY_AIRDROP_TOKENS,
    xFeeStatus,
    launchMode,
  },
  {
    invalidLaunchSocial,
    getFeeDistributionInputs,
    getCommunityAirdropTokens,
    getCreatorBuySol,
    developerBuyLimitReached,
    xFeeFailureDetail,
    getLaunchBurnPolicy,
    formatLaunchBurnAmount,
    document = globalThis.document,
  } = {}
) {
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  if (step === 1) {
    try{assertImageReady();}catch(error){return {valid:false,message:error.message};}
    if (!name) return { valid: false, field: '#token-name', message: 'Enter the token name to continue.' };
    if (name.length > 32) return { valid: false, field: '#token-name', message: 'Use 32 characters or fewer for the token name.' };
    if (!symbol) return { valid: false, field: '#token-symbol', message: 'Enter a ticker to continue.' };
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return { valid: false, field: '#token-symbol', message: 'Use 1–10 letters or numbers for the ticker.' };
    const invalidSocial = invalidLaunchSocial();
    if (invalidSocial) return { valid: false, field: `#${invalidSocial.id}`, message: invalidSocial.validationMessage };
    return { valid: true, message: 'Coin identity is ready.' };
  }
  const distribution = validateFeeDistribution(getFeeDistributionInputs());
  if (step === 2) {
    const communityTokens = getCommunityAirdropTokens();
    if (!Number.isSafeInteger(communityTokens) || communityTokens < MIN_COMMUNITY_AIRDROP_TOKENS || communityTokens > MAX_COMMUNITY_AIRDROP_TOKENS) return { valid: false, field: '#community-airdrop-tokens', message: 'Community airdrop must be between 30,000,000 and 500,000,000 tokens.' };
    const creatorBuySol = getCreatorBuySol();
    if (!Number.isFinite(creatorBuySol) || creatorBuySol < 0) return { valid: false, field: '#creator-buy-sol', message: 'Developer buy must be a valid SOL amount of zero or more.' };
    if (developerBuyLimitReached()) return { valid: false, field: '#creator-buy-sol', message: 'Developer buy exceeds 20% of supply. Lower the SOL amount or set it to 0.' };
    if (!distribution.valid) {
      if (!distribution.sharesValid) return { valid: false, message: 'Each creator destination must be between 0% and 80%.' };
      if (!distribution.xRecipientValid) return { valid: false, message: 'Enter a valid X account for the SOL reward.' };
      return { valid: false, message: 'Creator wallet, holder rewards, and X account reward must total exactly 80%.' };
    }
    if (distribution.shares.solClaimPercent > 0 && !xFeeStatus.ready) return { valid: false, message: `X account rewards unavailable: ${xFeeFailureDetail()}.` };
    const launchBurn = getLaunchBurnPolicy();
    const burnValidation = validateLaunchBurnPolicy(launchBurn);
    if (!burnValidation.valid) return { valid: false, message: 'The protocol $FUNDED mint must be configured before a paid burn tier can launch.' };
    return { valid: true, message: launchBurn.requiresBurn ? `${launchBurn.label} selected: ${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED will be burned. Review the approval steps before signing.` : launchMode === 'quick' ? 'Recommended distribution selected.' : 'Custom distribution is balanced.' };
  }
  return { valid: true, message: 'Launch settings are ready.' };
}

export function getLaunchSubmissionState(
  {
    feeRouterState,
    wallet,
    walletMetricsLoading,
    launchCostReview,
    walletBalanceLamports,
    estimatedLaunchFeeLamports,
    walletEstimateError,
    launchBurnReadiness,
  },
  {
    creatorBuyExceedsWalletBalance,
    developerBuyLimitReached,
    getLaunchBurnPolicy,
    document = globalThis.document,
  } = {}
) {
    if (!feeRouterState.verified) return { valid: false, message: feeRouterState.status === 'checking'
      ? 'Checking the Solana fee router…'
      : feeRouterState.status === 'router-verification-unavailable'
        ? 'Fee-router verification could not reach Solana. Retry checks before signing.'
        : feeRouterState.status === 'program-id-not-configured'
          ? 'The fee-router program is not configured for this site.'
          : 'The fee-router policy is not verified on Solana. Retry checks before signing.' };
    if (!wallet) return { valid: false, message: 'Connect a wallet to continue to signing.' };
    if (!canSignTransactions(wallet)) return { valid: false, message: 'Open this app inside your wallet to sign.' };
    if (walletMetricsLoading) return { valid: false, message: 'Wait while the launch cost is calculated.' };
    if (creatorBuyExceedsWalletBalance()) return { valid: false, message: 'Reduce the developer buy or add SOL before continuing.' };
    if (developerBuyLimitReached()) return { valid: false, message: 'Developer buy exceeds 20% of supply. Lower the SOL amount or set it to 0.' };
    if (!freshLaunchReview(launchCostReview)) return { valid:false, message:'Refresh the launch estimate before continuing; quotes expire after one minute.' };
    if (walletBalanceLamports == null || estimatedLaunchFeeLamports == null) return { valid: false, message: walletEstimateError ? `Launch estimate unavailable: ${walletEstimateError}` : 'Refresh the wallet balance and launch estimate.' };
    if (walletBalanceLamports < estimatedLaunchFeeLamports) return { valid: false, message: 'Add SOL before continuing.' };
    const launchBurn = getLaunchBurnPolicy();
    if (launchBurn.requiresBurn && !launchBurnReadiness.ready) return { valid: false, message: launchBurnReadiness.message };
    if (!document.querySelector('#fee-route-agree').checked) return { valid: false, message: 'Confirm that the Pump creator-fee route belongs to funded.vip.' };
    if (!document.querySelector('#terms-agree').checked) return { valid: false, message: 'Accept the Terms and Disclosures to continue.' };
    return { valid: true, message: 'Ready to review the transaction before signing.' };
}
