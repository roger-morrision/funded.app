import { getPreparedImage } from '../../../launch-image.js';
import { FEE_DISTRIBUTION, validateFeeDistribution } from '../../../distribution-policy.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function updateLaunchPreview(
  {
    wallet,
    feeRouterState,
    xFeeStatus,
    EXPLORE_CLUSTER,
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
    xFeeFailureDetail,
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
  if (descriptionCounter) descriptionCounter.textContent = `${description.length}/280 · shown on your coin page`;
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
  const xPrefix = EXPLORE_CLUSTER === 'devnet' ? '[Devnet test] ' : '[Mainnet] ';
  const xLink = 'funded.vip/token/your-token';
  const xLaunch = launchBurn.tier === 'standard'
    ? `New project on funded.vip: “${xLabel}”. Token creation finalized.`
    : `${launchBurn.tier === 'premier' ? 'Premier' : 'Pro'} launch: “${xLabel}”. Creation and $FUNDED tier burn finalized.`;
  const xPost = document.querySelector('#launch-x-post-preview');
  if (xPost) xPost.textContent = `${xPrefix}${xLaunch}\n${xLink}`;
  const xPostCount = document.querySelector('#launch-x-post-count');
  if (xPostCount) xPostCount.textContent = launchBurn.tier === 'premier' ? '2 posts' : '1 post';
  const xFollowup = document.querySelector('#launch-x-followup');
  if (xFollowup) xFollowup.hidden = launchBurn.tier !== 'premier';
  const xFollowupText = document.querySelector('#launch-x-followup-preview');
  if (xFollowupText) xFollowupText.textContent = `${xPrefix}Premier project follow-up: “${xLabel}”. Explore the verified launch and public token page.\n${xLink}`;
  const buyLabel = creatorBuy.sol > 0 ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL${creatorBuy.tokens > 0 ? ` · ${Math.round(creatorBuy.tokens).toLocaleString()} tokens` : ''}` : 'Creation only';
  const previewBuy = document.querySelector('#preview-creator-buy');
  if (previewBuy) previewBuy.textContent = buyLabel;
  const buyTokensNode = document.querySelector('#creator-buy-token-amount');
  const buySolNode = document.querySelector('#creator-buy-sol-amount');
  if (buyTokensNode) buyTokensNode.textContent = creatorBuyExceedsWalletBalance() ? 'Insufficient SOL' : creatorBuy.tokens > 0 ? `${Math.round(creatorBuy.tokens).toLocaleString()} tokens` : creatorBuy.sol > 0 ? wallet ? 'Calculating…' : 'Connect wallet to estimate' : 'None';
  if (buySolNode) buySolNode.textContent = creatorBuy.sol > 0 ? `${creatorBuy.sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL developer buy` : 'No developer buy';
  const image = getPreparedImage();
  const roadmap = document.querySelector('#token-roadmap')?.value.trim() || '';
  const website = document.querySelector('#token-website')?.value.trim() || '';
  const quality = [Boolean(image), Boolean(tagline), Boolean(website || document.querySelector('#token-x')?.value.trim() || document.querySelector('#token-telegram')?.value.trim() || document.querySelector('#token-discord')?.value.trim()), Boolean(roadmap)];
  const qualityLabels = ['logo', 'thesis', 'links', 'roadmap'];
  const qualityCount = quality.filter(Boolean).length;
  const qualityScore = document.querySelector('#preview-quality-score');
  const qualityFill = document.querySelector('#preview-quality-fill');
  if (qualityScore) qualityScore.textContent = `${qualityCount} / 4 ready`;
  if (qualityFill) qualityFill.style.width = `${qualityCount / 4 * 100}%`;
  qualityLabels.forEach((key, index) => { const node = document.querySelector(`#preview-quality-${key}`); if (node) { node.textContent = `${quality[index] ? '✓' : '○'} ${key === 'links' ? 'Official link' : key === 'roadmap' ? 'Milestones' : key[0].toUpperCase() + key.slice(1)}`; node.classList.toggle('ready', quality[index]); } });
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
  const previewBurnTier = document.querySelector('#preview-burn-tier');
  if (previewBurnTier) { previewBurnTier.textContent = launchBurn.label; previewBurnTier.className = `tier-badge ${launchBurn.tier}`; }
  const promotionBadge = document.querySelector('#preview-promotion-badge');
  if (promotionBadge) {
    promotionBadge.textContent = launchBurn.label;
    promotionBadge.className = `preview-promotion-badge ${launchBurn.tier}`;
  }
  const previewBurnAmount = document.querySelector('#preview-burn-amount');
  if (previewBurnAmount) previewBurnAmount.textContent = launchBurn.requiresBurn ? `${formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED` : 'None';
  const routerPreview = document.querySelector('#preview-fee-router');
  if (routerPreview) routerPreview.textContent = feeRouterState.verified ? `100% → ${feeRouterState.address.slice(0, 4)}…${feeRouterState.address.slice(-4)}` : 'Launch blocked';
  const feeStatus = document.querySelector('#fee-distribution-status');
  if (feeStatus) {
    const validation = validateFeeDistribution(feeDistribution);
    feeStatus.textContent = validation.valid
      ? feeDistribution.solClaimPercent > 0
        ? xFeeStatus.ready ? 'X rewards use an isolated per-coin fee router and verified X + wallet claim.' : `X account rewards unavailable: ${xFeeFailureDetail()}.`
        : ''
      : !validation.sharesValid
        ? 'Each creator destination must be between 0% and 80%.'
        : !validation.xRecipientValid
          ? 'Enter a valid X account for the SOL reward.'
          : 'Creator wallet, holder rewards, and X account reward must total exactly 80%.';
    feeStatus.className = `field-help ${validation.valid && (feeDistribution.solClaimPercent === 0 || xFeeStatus.ready) ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
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
