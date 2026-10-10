import { freshLaunchReview, launchReviewMarkup } from '../../../launch-review.js';
import { validateFeeDistribution } from '../../../distribution-policy.js';
import { validateLaunchBurnPolicy } from '../../../launch-burn-policy.js';
import { canSignTransactions } from '../../../wallet-core.js';
import { launchReviewStillCurrent } from '../../../launch-review-gate.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function updateLaunchButton(
  {
    walletBalanceLamports,
    estimatedLaunchFeeLamports,
    wallet,
    launchCostReview,
    estimatedInitialBuyTokens,
    LAUNCH_TOKEN_SUPPLY,
    MIN_COMMUNITY_AIRDROP_TOKENS,
    MAX_COMMUNITY_AIRDROP_TOKENS,
    launchBurnReadiness,
    xFeeStatus,
    feeRouterState,
    walletMetricsLoading,
    PROTOCOL_FUNDED_MINT,
    APP_MAINNET_READ_ONLY,
  },
  {
    creatorBuyExceedsWalletBalance,
    getFeeDistributionInputs,
    getLaunchBurnPolicy,
    getCreatorBuySol,
    developerBuyLimitReached,
    getCommunityAirdropTokens,
    getLaunchStepState,
    launchEstimateRefreshAvailable,
    updateLaunchNavigation,
    document = globalThis.document,
  } = {}
) {
  const button = document.querySelector('#launch-button');
  const insufficient = walletBalanceLamports != null && estimatedLaunchFeeLamports != null && walletBalanceLamports < estimatedLaunchFeeLamports;
  const insufficientDeveloperBuy = creatorBuyExceedsWalletBalance();
    const balanceUnknown = wallet && (walletBalanceLamports == null || estimatedLaunchFeeLamports == null || !freshLaunchReview(launchCostReview));
  const feeDistribution = validateFeeDistribution(getFeeDistributionInputs());
  const launchBurn = getLaunchBurnPolicy();
  const creatorBuySol = getCreatorBuySol();
  const overBuyLimit = developerBuyLimitReached();
  const buyValid = Number.isFinite(creatorBuySol) && creatorBuySol >= 0 && !overBuyLimit && (estimatedInitialBuyTokens <= 0 || estimatedInitialBuyTokens <= LAUNCH_TOKEN_SUPPLY * .2);
  const buyHelp = document.querySelector('#creator-buy-help');
  if (buyHelp) buyHelp.textContent = overBuyLimit
    ? 'This SOL amount would buy over 20% of the supply. Lower it or set it to 0; the quote will update automatically.'
    : 'Enter the SOL to buy from the fresh curve. Maximum 20% of supply.';
  const buyInput = document.querySelector('#creator-buy-sol');
  if (buyInput) {
    if (overBuyLimit) {
      buyInput.dataset.overLimit = 'true';
      buyInput.setAttribute('aria-invalid', 'true');
    } else if (buyInput.dataset.overLimit) {
      delete buyInput.dataset.overLimit;
      buyInput.removeAttribute('aria-invalid');
    }
  }
  const buyTokens = document.querySelector('#creator-buy-token-amount');
  if (buyTokens && overBuyLimit) buyTokens.textContent = 'Over 20% limit';
  const communityTokens = getCommunityAirdropTokens();
  const communityValid = Number.isSafeInteger(communityTokens) && communityTokens >= MIN_COMMUNITY_AIRDROP_TOKENS && communityTokens <= MAX_COMMUNITY_AIRDROP_TOKENS;
  const burnConfigured = validateLaunchBurnPolicy(launchBurn).valid;
  const burnReady = !launchBurn.requiresBurn || launchBurnReadiness.ready;
  const xRouteReady = feeDistribution.shares.solClaimPercent === 0 || xFeeStatus.ready;
  const identityValid = getLaunchStepState(1).valid;
  const policyValid = identityValid && getLaunchStepState(2).valid && feeDistribution.valid && xRouteReady && feeRouterState.verified && burnConfigured && burnReady && buyValid && communityValid;
  const ready = Boolean(canSignTransactions(wallet) && !walletMetricsLoading && !balanceUnknown && !insufficient && policyValid && document.querySelector('#terms-agree')?.checked && document.querySelector('#fee-route-agree')?.checked && document.querySelector('#token-name').value.trim() && document.querySelector('#token-symbol').value.trim());
  const estimateRefreshReady = launchEstimateRefreshAvailable({
    policyValid,
    hasWallet: Boolean(wallet),
    signingReady: canSignTransactions(wallet),
    loading: walletMetricsLoading,
    developerBuyBlocked: insufficientDeveloperBuy,
    estimateUnavailable: balanceUnknown,
  });
  const connectReady = !wallet && !APP_MAINNET_READ_ONLY && identityValid && getLaunchStepState(2).valid && feeDistribution.valid && xRouteReady && burnConfigured && buyValid && communityValid;
  button.disabled = !(ready || estimateRefreshReady || connectReady);
  button.dataset.launchAction = connectReady ? 'connect-wallet' : estimateRefreshReady ? 'refresh-estimate' : 'launch';
  button.textContent = !communityValid ? 'Airdrop must be 30M–500M' : !identityValid ? 'Fix coin details' : !feeDistribution.valid ? 'Fix fee distribution' : !xRouteReady ? 'X account rewards unavailable' : !feeRouterState.verified ? 'Fee router required' : overBuyLimit ? 'Reduce developer buy' : !buyValid ? 'Enter a valid developer buy' : !burnConfigured ? (PROTOCOL_FUNDED_MINT ? '$FUNDED price unavailable' : '$FUNDED mint required') : launchBurn.requiresBurn && !burnReady ? 'Verify $FUNDED balance' : !wallet ? 'Connect wallet to launch' : !canSignTransactions(wallet) ? 'Open in wallet to sign' : walletMetricsLoading ? 'Calculating launch cost' : walletBalanceLamports == null ? 'Refresh wallet balance' : insufficientDeveloperBuy ? 'Insufficient SOL for developer buy' : estimatedLaunchFeeLamports == null ? 'Refresh launch estimate' : insufficient ? 'Insufficient SOL for launch' : !document.querySelector('#fee-route-agree')?.checked ? 'Confirm the fee route' : !document.querySelector('#terms-agree')?.checked ? 'Agree to terms to launch' : !policyValid ? 'Complete launch policy' : ready ? (launchBurn.requiresBurn ? `Review launch · ${launchBurn.label}` : 'Review launch') : 'Add name and ticker';
  if (connectReady) button.textContent = 'Connect wallet to create coin';
  updateLaunchNavigation();
}

export function updateLaunchNavigation(
  {
    launchStep,
    feeRouterState,
    wallet,
    estimatedLaunchFeeLamports,
    launchCostReview,
    walletMetricsLoading,
  },
  {
    getLaunchStepState,
    getLaunchSubmissionState,
    developerBuyLimitReached,
    document = globalThis.document,
  } = {}
) {
  const next = document.querySelector('#launch-next');
  const back = document.querySelector('#launch-back');
  const retry = document.querySelector('#launch-review-retry');
  const hint = document.querySelector('#wizard-hint');
  if (!next || !back || !hint) return;
  const stepState = getLaunchStepState(launchStep);
  const state = launchStep === 2 && stepState.valid ? getLaunchSubmissionState() : stepState;
  back.hidden = launchStep === 1;
  next.hidden = launchStep === 2;
  next.disabled = false;
  next.textContent = 'Continue to rewards';
  if (retry) {
    retry.hidden = launchStep !== 2 || (feeRouterState.verified && (!wallet || (estimatedLaunchFeeLamports != null && freshLaunchReview(launchCostReview))));
    retry.disabled = feeRouterState.status === 'checking' || walletMetricsLoading;
    retry.textContent = retry.disabled ? 'Checking…' : developerBuyLimitReached() ? 'Edit developer buy' : 'Retry checks';
  }
  const inlineWarning = state.messageTarget && document.querySelector(state.messageTarget);
  hint.hidden = Boolean(inlineWarning?.getClientRects().length);
  hint.textContent = hint.hidden ? '' : state.message;
  hint.classList.toggle('ready', state.valid);
}

export function updateLaunchIdentityWarnings(
  {},
  {
    document = globalThis.document,
  } = {}
) {
  const name = document.querySelector('#token-name');
  const symbol = document.querySelector('#token-symbol');
  const entries = [
    [name, document.querySelector('#token-name-warning'), !name?.value.trim() ? 'Enter a token name.' : name.value.trim().length > 32 ? 'Use 32 characters or fewer.' : ''],
    [symbol, document.querySelector('#token-symbol-warning'), !symbol?.value.trim() ? 'Enter a ticker.' : !/^[A-Z0-9]{1,10}$/.test(symbol.value.trim().toUpperCase()) ? 'Use 1–10 letters or numbers.' : ''],
  ];
  for (const [input, warning, message] of entries) {
    if (!input || !warning) continue;
    const show = input.dataset.launchTouched === 'true' && Boolean(message);
    warning.textContent = message;
    warning.hidden = !show;
    if (show) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

export function renderPendingLaunchReview(
  {
    pendingLaunchReview,
  },
  {
    currentLaunchReviewState,
    document = globalThis.document,
  } = {}
) {
  const dialog = document.querySelector('#launch-review-dialog');
  if (!dialog?.open) return;
  const pending = pendingLaunchReview;
  const current = launchReviewStillCurrent(pending, currentLaunchReviewState());
  const details = document.querySelector('#launch-review-details');
  const confirm = document.querySelector('#launch-review-confirm');
  const renderKey = `${pending?.reviewedCost?.quotedAt}:${current}`;
  if (details && details.dataset.reviewKey !== renderKey) {
    details.dataset.reviewKey = renderKey;
    details.innerHTML = current
    ? launchReviewMarkup(pending.reviewedCost)
    : '<p role="status">Launch estimate expired or changed. Go back, refresh the estimate, and review again; no transaction was sent.</p>';
  }
  if (confirm) {
    confirm.disabled = !current;
    confirm.textContent = current ? 'Continue to wallet' : 'Estimate expired — go back';
  }
}
