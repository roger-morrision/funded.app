import { escapeHtml, formatDashboardUsd, formatCompactUsd } from '../shared/display.js';
import { activeBoostMultiplier } from '../../../boost-offer.js';
import { icon } from '../../../ui-icons.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function homeLaunchFeeRouteMarkup(
  policy,
  {},
  {
    verifiedPolicyPercent,
    formatVerifiedPercent,
    document = globalThis.document,
  } = {}
) {
  if (!policy?.onchainVerified) return '';
  const shares = policy.feeDistribution?.creatorDirected?.shares;
  const creator = verifiedPolicyPercent(shares?.creatorWalletPercent);
  const holders = verifiedPolicyPercent(shares?.holderAirdropPercent);
  const x = verifiedPolicyPercent(shares?.solClaimPercent);
  if ([creator, holders, x].some(value => value == null) || Math.abs(creator + holders + x - 80) > 0.001) return '';
  const xHandle = String(policy.feeDistribution?.creatorDirected?.recipients?.xAccount || '');
  const xName = /^@[A-Za-z0-9_]{1,15}$/.test(xHandle) ? xHandle : 'X partner';
  const recipients = [
    creator > 0 ? `Creator ${formatVerifiedPercent(creator)}` : '',
    holders > 0 ? `Holders ${formatVerifiedPercent(holders)}` : '',
    x > 0 ? `${xName} ${formatVerifiedPercent(x)}` : '',
  ].filter(Boolean);
  const summary = recipients.join(' · ');
  return `<div class="home-launch-fee-route" title="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}"><span>${recipients.map(escapeHtml).join(' · ')}</span></div>`;
}

export function launchCardVolumeUsd(
  item,
  window,
  {
    coinSolUsdPrice,
    EXPLORE_CLUSTER,
  },
  {
    document = globalThis.document,
  } = {}
) {
  if (EXPLORE_CLUSTER === 'devnet') {
    if (item.windowCoverage === 'complete' && item.windowTradeCount != null && Number(item.windowTradeCount) === 0) return 'No trades';
    if (item.windowVolumeSol == null) return '$—';
    return Number.isFinite(coinSolUsdPrice)
      ? formatDashboardUsd(Number(item.windowVolumeSol) * coinSolUsdPrice, { partial: item.windowCoverage === 'partial' })
      : `${Number(item.windowVolumeSol).toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL`;
  }
  return window === '24h' && item.volume24hUsd != null ? formatDashboardUsd(item.volume24hUsd) : '$—';
}

export function homeLaunchCardMarkup(
  item,
  { volumeLabel, volumeValue, extraClass, extraActions, footerNote },
  {
    verifiedBoosts,
    EXPLORE_CLUSTER,
  },
  {
    exploreStageLabel,
    formatOnchainAge,
    formatCoinUsd,
    verifiedLaunchPolicyForMint,
    homeLaunchFeeRouteMarkup,
    exploreSocialLinksMarkup,
    tokenCardWatchMarkup,
    exploreBoostAmountMarkup,
    tokenCardShareMarkup,
    document = globalThis.document,
  } = {}
) {
    const change = item.change || '—';
    const changeValue = Number.parseFloat(change);
    const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
    const progressValue = item.complete === true ? 100 : Number.isFinite(Number(item.curveProgressPercent)) ? Math.max(0, Math.min(100, Number(item.curveProgressPercent))) : 0;
    const progressLabel = item.complete === true ? 'Migrated' : progressValue > 0 ? `${Math.round(progressValue)}% filled` : 'On curve';
    const stageLabel = item.marketUnavailable ? 'Market unavailable' : exploreStageLabel(item);
    const ageLabel = item.createdTimestamp ? formatOnchainAge(Number(item.createdTimestamp) * 1000) : 'Age unavailable';
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    const capLabel = item.migrated === true ? 'Market cap' : 'Curve cap';
    const hasNoObservedTrades = item.windowCoverage === 'complete' && item.windowTradeCount != null && Number(item.windowTradeCount) === 0;
    const shownVolume = volumeValue;
    const value = EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(capSol) : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : '—';
    const providerHolders = item.holders == null || item.holders === '' ? NaN : Number(item.holders);
    const accountHolders = item.holderWalletCount == null || item.holderWalletCount === '' ? NaN : Number(item.holderWalletCount);
    const holderCount = Number.isFinite(providerHolders) && providerHolders >= 0
      ? providerHolders.toLocaleString()
      : Number.isFinite(accountHolders) && accountHolders >= 0 ? `${item.holderWalletCoverage === 'lower-bound' ? '≥' : ''}${accountHolders.toLocaleString()}` : '—';
    const holderTitle = Number.isFinite(providerHolders)
      ? 'Holder count from the indexed market provider'
      : Number.isFinite(accountHolders) ? `${item.holderWalletCoverage === 'lower-bound' ? 'At least ' : ''}${accountHolders} distinct wallet owner${accountHolders === 1 ? '' : 's'} in confirmed non-vault token accounts${item.holderWalletCoverage === 'lower-bound' ? ' · largest-account sample only' : ''}` : 'Verified holder count unavailable';
    const launchPolicy = verifiedLaunchPolicyForMint(item.address);
    const mintLabel = item.address ? `${item.address.slice(0, 5)}…${item.address.slice(-4)}` : 'Unavailable';
    const creatorWallet = launchPolicy?.onchainVerified && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(launchPolicy.creatorWallet || '')
      ? launchPolicy.creatorWallet : '';
    const creatorLabel = creatorWallet ? `${creatorWallet.slice(0, 5)}…${creatorWallet.slice(-4)}` : '';
    const feeRoute = homeLaunchFeeRouteMarkup(launchPolicy);
    const boost = verifiedBoosts[item.address];
    const boostMultiplier = activeBoostMultiplier(boost);
    const activeBoost = boostMultiplier > 0;
    return `<article class="token-card-shell home-launch-card${extraClass}" data-mint="${escapeHtml(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}">
      <a class="home-launch-card-link" href="/token/${encodeURIComponent(item.address || '')}" aria-label="Open ${escapeHtml(item.name || item.symbol || 'token')} token details"></a>
      <div class="home-launch-card-media"><span class="home-token-avatar">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}</span>${exploreSocialLinksMarkup(item)}${tokenCardWatchMarkup(item.address, item.symbol)}<span class="home-launch-media-stage">${escapeHtml(stageLabel)}</span><div class="home-launch-media-badges"><span class="home-launch-media-package"></span></div></div>
      <div class="home-launch-card-top">
        <span class="home-token-identity"><strong class="${activeBoost && boostMultiplier >= 500 ? 'golden-ticker' : ''}">${escapeHtml(item.symbol || 'TOKEN')}</strong>${exploreBoostAmountMarkup(item.address)}<small>${escapeHtml(item.name || 'Unnamed token')}</small></span>
        <div class="home-launch-card-addresses"><span title="Token contract: ${escapeHtml(item.address || '')}"><small>CA</small><code>${escapeHtml(mintLabel)}</code><button type="button" class="home-launch-copy-address" data-copy-address="${escapeHtml(item.address || '')}" data-copy-kind="token" aria-label="Copy full token address" title="Copy full token address">${icon('copy')}</button></span>${creatorWallet ? `<span title="Verified launch creator: ${escapeHtml(creatorWallet)}"><small>Creator</small><code>${escapeHtml(creatorLabel)}</code><button type="button" class="home-launch-copy-address" data-copy-address="${escapeHtml(creatorWallet)}" data-copy-kind="creator" aria-label="Copy full creator wallet address" title="Copy full creator wallet address">${icon('copy')}</button></span>` : ''}</div>
        ${feeRoute}
      </div>
      <div class="home-launch-card-stats">
        <span><small>${EXPLORE_CLUSTER === 'devnet' ? capLabel : 'Market cap'}</small><strong>${escapeHtml(value)}</strong></span>
        <span><small>${escapeHtml(volumeLabel)} volume</small><strong>${escapeHtml(shownVolume)}</strong></span>
        <span title="${escapeHtml(holderTitle)}"><small>Holders</small><strong>${escapeHtml(holderCount)}</strong></span>
        <span class="home-launch-change ${changeClass}"><small>24h change</small><strong>${escapeHtml(hasNoObservedTrades ? 'No trades' : change)}</strong></span>
      </div>
      <div class="home-launch-progress" aria-label="${escapeHtml(progressLabel)}"><i style="--launch-progress:${progressValue}%"></i></div>
      <div class="home-launch-meta"><span>${escapeHtml(ageLabel)}</span><span>${escapeHtml(progressLabel)}</span></div>
      ${footerNote ? `<small class="home-launch-evidence">${escapeHtml(footerNote)}</small>` : ''}
      <div class="home-launch-card-actions">${tokenCardShareMarkup(item.address, item.symbol, item.name)}<button type="button" class="token-card-action-boost" data-boost-mint="${escapeHtml(item.address || '')}" aria-label="Boost ${escapeHtml(item.symbol || 'token')}">${icon('boost')}<span>Boost</span></button>${extraActions}</div>
    </article>`;
}

export function decorateHomeLaunchCard(
  card,
  mint,
  {},
  {
    promotionElement,
    promotionForMint,
    verifiedLaunchPolicyForMint,
    document = globalThis.document,
  } = {}
) {
  const packageBadge = card.querySelector('.home-launch-media-package');
  const promotion = promotionElement(mint, true);
  if (promotion) {
    const launchPromotion = promotionForMint(mint);
    if (launchPromotion?.tier === 'boost') promotion.textContent = `Boost · ${launchPromotion.amountTokens.toLocaleString()} $FUNDED`;
    packageBadge?.append(promotion);
  } else if (verifiedLaunchPolicyForMint(mint)?.onchainVerified) {
    const standard = document.createElement('span');
    standard.className = 'home-launch-package-standard';
    standard.textContent = 'Standard';
    standard.title = 'Standard launch package · verified policy, no paid launch promotion';
    packageBadge?.append(standard);
  } else packageBadge?.remove();
}
