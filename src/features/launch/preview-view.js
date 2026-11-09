import { readDeveloperLockSeconds } from '../../../developer-lock-period.js';
import { getPreparedImage } from '../../../launch-image.js';
import { FEE_DISTRIBUTION, validateFeeDistribution } from '../../../distribution-policy.js';
import { launchPromotionCopy } from '../../../launch-promotion-copy.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function updateLaunchPreview(
  {
    wallet,
    feeRouterState,
    publicQuote,
  },
  {
    getCommunityAllocationPercent,
    getCommunityAirdropTokens,
    getFeeDistributionInputs,
    getLaunchBurnPolicy,
    getBannerPreviewUrl,
    getCreatorBuySummary,
    creatorBuyExceedsWalletBalance,
    formatVerifiedPercent,
    formatLaunchBurnAmount,
    renderLaunchBurnSelection,
    updateLaunchNavigation,
    document = globalThis.document,
  } = {}
) {
  const name = document.querySelector('#token-name').value.trim();
  const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
  const allocation = getCommunityAllocationPercent();
  const communityTokens = getCommunityAirdropTokens();
  const feeDistribution = getFeeDistributionInputs();
  const launchBurn = getLaunchBurnPolicy();
  const creatorBuy = getCreatorBuySummary();
  document.querySelector('#preview-name').textContent = name || 'Token name';
  document.querySelector('#preview-symbol').textContent = symbol || 'TICKER';
  const description = document.querySelector('#token-description')?.value || '';
  const descriptionCounter = document.querySelector('#token-description-counter');
  if (descriptionCounter) descriptionCounter.textContent = `${description.length}/280`;
  const tagline = document.querySelector('#token-tagline')?.value.trim() || '';
  const taglinePreview = document.querySelector('#preview-tagline');
  if (taglinePreview) taglinePreview.textContent = tagline || description.trim() || 'Your coin description appears here.';
  const packageExample = document.querySelector('#launch-package-example');
  if (packageExample) packageExample.dataset.tier = launchBurn.tier;
  const packageArtwork = document.querySelector('#launch-package-example-art');
  if (packageArtwork) {
    const bannerUrl = launchBurn.requiresBurn ? getBannerPreviewUrl?.() : null;
    const tokenImageUrl = getPreparedImage() ? document.querySelector('#preview-token-image')?.style.backgroundImage : '';
    packageArtwork.style.backgroundImage = bannerUrl ? `url("${bannerUrl}")` : tokenImageUrl || '';
    packageArtwork.classList.toggle('has-image', Boolean(bannerUrl || tokenImageUrl));
  }
  const packageLabel = document.querySelector('#launch-package-label');
  if (packageLabel) packageLabel.textContent = launchBurn.label;
  const previewSummary = document.querySelector('#launch-presentation-preview > summary');
  if (previewSummary) previewSummary.textContent = `Preview token page & X posts · ${launchBurn.label}`;
  const packageArtBadge = document.querySelector('#launch-package-art-badge');
  if (packageArtBadge) packageArtBadge.textContent = `${launchBurn.label.toUpperCase()} PROMOTION`;
  const cleanedXLabel = (name || symbol || 'Token name').normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'Unnamed token';
  let xLabel = '', xLabelWeight = 0;
  for (const character of cleanedXLabel) {
    const weight = character.codePointAt(0) <= 0x7f ? 1 : 2;
    if (xLabelWeight + weight > 32) break;
    xLabel += character;
    xLabelWeight += weight;
  }
  xLabel = xLabel.trim() || 'Token';
  const xLink = 'richpad.fun/token/your-token';
  const xLaunch = launchPromotionCopy(xLabel, launchBurn.tier);
  const xPost = document.querySelector('#launch-x-post-preview');
  if (xPost) xPost.textContent = `${xLaunch}\n${xLink}`;
  const xPostCount = document.querySelector('#launch-x-post-count');
  if (xPostCount) xPostCount.textContent = launchBurn.tier === 'premier' ? '2 posts' : '1 post';
  const xFollowup = document.querySelector('#launch-x-followup');
  if (xFollowup) xFollowup.hidden = launchBurn.tier !== 'premier';
  const xFollowupText = document.querySelector('#launch-x-followup-preview');
  if (xFollowupText) xFollowupText.textContent = `${launchPromotionCopy(xLabel, 'premier', { followup:true })}\n${xLink}`;
  const quotedBuyTokens = creatorBuy.tokens || (!wallet && publicQuote?.status === 'ready' ? publicQuote.developerTokens : 0);
  const lockHours = readDeveloperLockSeconds(document) / 3600;
  const buyLabel = creatorBuy.sol > 0 ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL${quotedBuyTokens > 0 ? ` · ${Math.round(quotedBuyTokens).toLocaleString()} tokens` : ''} · ${lockHours}h lock` : 'Creation only';
  const previewBuy = document.querySelector('#preview-creator-buy');
  if (previewBuy) previewBuy.textContent = buyLabel;
  const lockHelp = document.querySelector('#creator-buy-lock-help');
  if (lockHelp) lockHelp.textContent = creatorBuy.sol > 0
    ? 'Token lock: '+lockHours+' hours after launch · claim on your coin page.'
    : 'Optional buy · tokens lock for '+lockHours+' hours after launch.';
  const buyTokensNode = document.querySelector('#creator-buy-token-amount');
  const buySolNode = document.querySelector('#creator-buy-sol-amount');
  const buyPreview=buyTokensNode?.closest?.('.creator-buy-preview');
  if(buyPreview)buyPreview.hidden=!(creatorBuy.sol>0);
  if (buyTokensNode) buyTokensNode.textContent = creatorBuyExceedsWalletBalance() ? 'Insufficient SOL' : quotedBuyTokens > 0 ? `${Math.round(quotedBuyTokens).toLocaleString()} tokens` : creatorBuy.sol > 0 ? wallet ? 'Calculating…' : publicQuote?.status === 'unavailable' ? 'Quote unavailable' : 'Calculating…' : 'None';
  if (buySolNode) buySolNode.textContent = creatorBuy.sol > 0 ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL developer buy` : 'No developer buy';
  const compactPreviewValues = {
    '#preview-launchpad': 'Pump.fun',
    '#preview-supply': '1 billion',
    '#preview-community': Number.isFinite(allocation) ? formatVerifiedPercent(allocation) : '—',
    '#preview-creator-wallet-share': `${feeDistribution.creatorWalletPercent}%`,
    '#preview-holder-share': `${feeDistribution.holderAirdropPercent}%`,
    '#preview-x-share': `${feeDistribution.solClaimPercent}%`,
    '#preview-funded-share': `${FEE_DISTRIBUTION.fundedPercent}%`,
  };
  Object.entries(compactPreviewValues).forEach(([selector, value]) => { const node = document.querySelector(selector); if (node) node.textContent = value; });
  const summaryName = document.querySelector('#launch-summary-name');
  const summarySymbol = document.querySelector('#launch-summary-symbol');
  if (summaryName) summaryName.textContent = name || 'Token name';
  if (summarySymbol) summarySymbol.textContent = symbol || 'TICKER';
  const summaryShares = {
    creator: feeDistribution.creatorWalletPercent,
    holders: feeDistribution.holderAirdropPercent,
    x: feeDistribution.solClaimPercent,
    protocol: FEE_DISTRIBUTION.fundedPercent,
  };
  for (const [key, share] of Object.entries(summaryShares)) {
    const value = Number.isFinite(Number(share)) ? Number(share) : 0;
    const label = document.querySelector(`#launch-summary-${key}`);
    const bar = document.querySelector(`[data-summary-share="${key}"]`);
    if (label) label.textContent = `${value}%`;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }
  const plainSplit = document.querySelector('#launch-summary-plain');
  if (plainSplit) plainSplit.textContent = launchFeeSentence({ symbol, creator: summaryShares.creator, holders: summaryShares.holders, x: summaryShares.x, xHandle: feeDistribution.xRecipient });
  const previewBurnTier = document.querySelector('#preview-burn-tier');
  if (previewBurnTier) { previewBurnTier.textContent = launchBurn.label; previewBurnTier.className = `tier-badge ${launchBurn.tier}`; }
  const promotionBadge = document.querySelector('#preview-promotion-badge');
  if (promotionBadge) {
    promotionBadge.textContent = launchBurn.label;
    promotionBadge.className = `preview-promotion-badge ${launchBurn.tier}`;
  }
  const previewBurnAmount = document.querySelector('#preview-burn-amount');
  if (previewBurnAmount) previewBurnAmount.textContent = launchBurn.requiresBurn ? `${formatLaunchBurnAmount(launchBurn.amountTokens)} $RICH` : 'None';
  const routerPreview = document.querySelector('#preview-fee-router');
  if (routerPreview) routerPreview.textContent = !feeRouterState.verified ? 'Launch blocked'
    : feeRouterState.scope === 'per-mint-v3' ? '100% → mint-specific V3 router'
      : `100% → ${feeRouterState.address.slice(0, 4)}…${feeRouterState.address.slice(-4)}`;
  const feeStatus = document.querySelector('#fee-distribution-status');
  if (feeStatus) {
    const validation = validateFeeDistribution(feeDistribution);
    feeStatus.textContent = validation.valid
      ? ''
      : !validation.sharesValid
        ? 'Each creator destination must be between 0% and 80%.'
        : !validation.xRecipientValid
          ? 'Enter a valid X account for the SOL reward.'
          : 'Creator wallet, holder rewards, and X account reward must total exactly 80%.';
    feeStatus.className = `field-help ${validation.valid ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
    feeStatus.style.display = feeStatus.textContent ? '' : 'none';
    const invalidShares = !validation.sharesValid || Math.abs(validation.total - FEE_DISTRIBUTION.creatorPercent) >= 0.001;
    for (const id of ['creator-wallet-share', 'holder-airdrop-share', 'x-share']) {
      const input = document.getElementById(id);
      if (invalidShares) input?.setAttribute('aria-invalid', 'true');
      else input?.removeAttribute('aria-invalid');
    }
  }
  renderLaunchBurnSelection();
  updateLaunchNavigation();
}

// The creator fee split in one plain sentence, so a creator can check who gets
// paid without reading the bar and legend.
export function launchFeeSentence({ symbol = '', creator = 0, holders = 0, x = 0, xHandle = '' } = {}) {
  const n = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const parts = [`you keep ${n(creator)}%`];
  if (n(holders) > 0) parts.push(`holders share ${n(holders)}%`);
  if (n(x) > 0) parts.push(`${/^@[A-Za-z0-9_]{1,15}$/.test(xHandle || '') ? xHandle : 'the X account'} gets ${n(x)}%`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `Of every creator fee ${symbol ? `$${symbol}` : 'your coin'} earns, ${list}. The other ${Math.max(0, 100 - n(creator) - n(holders) - n(x))}% pays for operations, referrals, the Daily bonus and $RICH burns.`;
}
