import { formatTokenBaseUnits } from '../../../funded-burn.js';
import { tokensToBaseUnits, validateLaunchBurnPolicy } from '../../../launch-burn-policy.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderLaunchBurnSelection(
  {
    connectedWalletAddress,
    fundedBurnState,
    LAUNCH_BURN_TIERS,
    launchTierPricing,
    launchTierQuote,
    launchBurnReadiness,
    PROTOCOL_FUNDED_MINT,
  },
  {
    getLaunchBurnPolicy,
    currentLaunchTierAmounts,
    currentLaunchTierQuote,
    formatLaunchBurnAmount,
    document = globalThis.document,
  } = {}
) {
  const policy = getLaunchBurnPolicy();
  const tierSection = document.querySelector('.creator-burn-section');
  if (tierSection) tierSection.dataset.selectedTier = policy.tier;
  const bannerUpload = document.querySelector('#launch-banner-upload');
  if (bannerUpload) bannerUpload.hidden = !policy.requiresBurn;
  const amounts = currentLaunchTierAmounts();
  const walletReady = Boolean(connectedWalletAddress && fundedBurnState.wallet === connectedWalletAddress && fundedBurnState.status === 'ready');
  const walletBalance = walletReady ? formatTokenBaseUnits(fundedBurnState.balanceBaseUnits, fundedBurnState.decimals, 6) : null;
  const walletNode = document.querySelector('#launch-tier-wallet-balance');
  if (walletNode) walletNode.textContent = walletReady ? `${walletBalance} $FUNDED available`
    : !connectedWalletAddress ? 'Connect wallet to check $FUNDED'
      : fundedBurnState.status === 'loading' ? 'Checking Devnet balance…' : 'Balance unavailable';
  const selectionNote = document.querySelector('.launch-tier-selection-note');
  if (selectionNote) selectionNote.textContent = `${policy.label} launch is selected. Your 80% creator-directed fee share goes to your wallet unless you choose a custom split.`;
  document.querySelectorAll('.creator-burn-card[data-burn-tier]').forEach(button => {
    const active = button.dataset.burnTier === policy.tier;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const tier = LAUNCH_BURN_TIERS.find(item => item.id === button.dataset.burnTier);
    const action = button.querySelector('b');
    if (action && tier) action.textContent = active ? 'Selected' : tier.id === 'standard' ? 'Included' : `Select ${tier.label}`;
  });
  for (const tier of ['pro', 'premier']) {
    const amount = policy.tier === tier && currentLaunchTierQuote() ? policy.amountTokens : amounts?.[tier];
    const count = document.querySelector(`#${tier}-burn-amount`);
    const progress = document.querySelector(`#${tier}-tier-progress`);
    if (count) count.textContent = amount ? `${formatLaunchBurnAmount(amount)} $FUNDED` : 'Quote unavailable';
    if (progress) {
      progress.textContent = amount && walletReady ? `${walletBalance} / ${formatLaunchBurnAmount(amount)} $FUNDED`
        : amount ? 'Connect wallet to check balance' : 'Waiting for verified price';
      progress.classList.toggle('short', Boolean(amount && walletReady && fundedBurnState.balanceBaseUnits < tokensToBaseUnits(amount, fundedBurnState.decimals)));
    }
  }
  const quoteStatus = document.querySelector('#launch-tier-quote-status');
  if (quoteStatus) quoteStatus.textContent = amounts
    ? `1 $FUNDED ≈ $${Number(launchTierPricing.tokenPriceUsd).toLocaleString(undefined, { maximumSignificantDigits:6 })} · verified pool slot ${launchTierPricing.slot} · exact burn locked at review`
    : currentLaunchTierQuote() ? `Your ${policy.label} quote is locked until ${new Date(launchTierQuote.expiresAt).toLocaleTimeString()}.`
      : 'Verified $FUNDED/USD pool price unavailable. Paid tiers cannot be launched until it refreshes.';
  const status = document.querySelector('#creator-burn-status');
  if (status) {
    const configured = validateLaunchBurnPolicy(policy).valid;
    const ready = !policy.requiresBurn || (configured && launchBurnReadiness.ready);
    status.className = `creator-burn-status ${ready ? 'ready' : 'blocked'}`;
    status.innerHTML = ready
      ? `<span>✓</span><p><strong>${policy.label} selected.</strong> ${policy.requiresBurn ? launchBurnReadiness.message : 'No creator-funded burn is required.'}</p>`
      : `<span>!</span><p><strong>${policy.label} cannot launch yet.</strong> ${configured ? launchBurnReadiness.message : PROTOCOL_FUNDED_MINT ? 'The verified $FUNDED price is unavailable.' : 'The protocol $FUNDED mint is not configured.'}</p>`;
  }
}
