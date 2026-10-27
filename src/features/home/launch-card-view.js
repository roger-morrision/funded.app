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

export function launchCardProgressState(item, providerStatus = '') {
  const migrated = item.migrated === true, complete = item.complete === true;
  const loading = providerStatus === 'On-chain only · loading';
  const stale = /\bstale\b/i.test(String(providerStatus));
  const value = migrated || complete ? 100 : null;
  const stage = migrated ? 'Migrated' : complete ? 'Curve complete' : item.complete === false ? 'On curve' : '';
  const retained = stale || (loading && value !== null);
  const text = migrated ? 'Migrated' : complete ? 'Curve complete · Migration not yet verified'
    : item.complete === false ? `On curve · ${loading ? 'Checking progress…' : 'Progress unavailable'}`
      : loading ? 'Checking progress…' : 'Progress unavailable';
  // The current real/virtual ratio has no admitted per-mint starting basis.
  return {
    kind: retained ? 'stale' : migrated ? 'migrated' : complete ? 'complete' : loading ? 'loading' : 'unavailable',
    value,
    text: `${retained || (loading && stage) ? 'Last verified · ' : ''}${text}`,
    stage: stage ? `${stale || loading ? 'Last verified · ' : ''}${stage}` : '',
  };
}

// Presentation bookkeeping only; the producer still owns the current status.
const progressFreshness = new WeakMap();
export function syncLaunchCardProgressFreshness(document, providerStatus) {
  const window = document?.defaultView;
  if (!window || typeof providerStatus !== 'string') return;
  let state = progressFreshness.get(document);
  if (!state) {
    state = {status:'', epoch:0, frame:0, pending:false, listening:false};
    const stop = () => {
      state.epoch++;
      window.cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.pending = false;
      if (state.listening) document.removeEventListener('focusout', leave);
      state.listening = false;
    };
    const update = () => {
      if (!/\bstale\b/i.test(state.status)) { stop(); return; }
      const rows = [...document.querySelectorAll('#home-launch-grid .home-launch-card > .home-launch-progress-row, #asset-grid .home-launch-card > .home-launch-progress-row, #creator-launch-empty .home-launch-card > .home-launch-progress-row')]
        .filter(row => row.isConnected);
      if (!rows.length) { stop(); return; }
      const active = document.activeElement, card = active?.closest?.('.home-launch-card');
      // A different visible group can also move this control through reflow.
      if (active?.isConnected && card?.querySelector('.home-launch-progress-row')
        && active.matches('a[href],button,input,select,textarea,summary,[tabindex]')
        && active.getClientRects().length && window.getComputedStyle(active).visibility === 'visible') {
        state.pending = true;
        if (!state.listening) document.addEventListener('focusout', leave);
        state.listening = true;
        return;
      }
      stop();
      for (const row of rows) {
        const value = row.querySelector('.home-launch-progress-heading > strong');
        if (!value) continue;
        const settled = value.textContent.replace('Checking progress…', 'Progress unavailable');
        const text = settled.startsWith('Last verified · ') ? settled : `Last verified · ${settled}`;
        if (value.textContent !== text) value.textContent = text;
        row.dataset.progressState = 'stale';
        const track = row.querySelector('.home-launch-progress[role="progressbar"]');
        if (track) track.setAttribute('aria-valuetext', text);
        const badge = row.parentElement.querySelector('.home-launch-card-media > .home-launch-media-stage');
        if (badge) badge.hidden = true;
      }
    };
    const leave = () => {
      if (!state.pending || state.frame) return;
      const epoch = state.epoch;
      state.frame = window.requestAnimationFrame(() => {
        if (epoch !== state.epoch || !state.pending) return;
        state.frame = 0;
        update();
      });
    };
    state.update = update;
    progressFreshness.set(document, state);
    window.addEventListener('funded:route-change', update);
    window.addEventListener('pagehide', stop);
  }
  state.status = providerStatus;
  state.update();
}

export function homeLaunchCardMarkup(
  item,
  { volumeLabel, volumeValue, extraClass, extraActions, footerNote },
  {
    verifiedBoosts,
    EXPLORE_CLUSTER,
    exploreProviderStatus = '',
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
    const progress = launchCardProgressState(item, exploreProviderStatus);
    const stageLabel = item.marketUnavailable ? 'Market unavailable' : progress.stage;
    const trackAttributes = progress.value === null ? 'aria-hidden="true"'
      : `role="progressbar" aria-label="Migration progress for ${escapeHtml(item.symbol || item.name || 'token')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" aria-valuetext="${escapeHtml(progress.text)}"`;
    const progressMarkup = `<div class="home-launch-progress-row" data-progress-state="${progress.kind}"><div class="home-launch-progress-heading"><span>Migration progress</span><strong>${escapeHtml(progress.text)}</strong></div><div class="home-launch-progress" ${trackAttributes}>${progress.value === null ? '' : '<i style="--launch-progress:100%"></i>'}</div></div>`;
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
    const socialLinks = exploreSocialLinksMarkup(item);
    const boost = verifiedBoosts[item.address];
    const boostMultiplier = activeBoostMultiplier(boost);
    const activeBoost = boostMultiplier > 0;
    return `<article class="token-card-shell home-launch-card${extraClass}" data-mint="${escapeHtml(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}">
      <a class="home-launch-card-link" href="/token/${encodeURIComponent(item.address || '')}" aria-label="Open ${escapeHtml(item.name || item.symbol || 'token')} token details"></a>
      <div class="home-launch-card-media"><span class="home-token-avatar">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}</span>${tokenCardWatchMarkup(item.address, item.symbol)}${stageLabel && !['loading', 'stale'].includes(progress.kind) ? `<span class="home-launch-media-stage">${escapeHtml(stageLabel)}</span>` : ''}<div class="home-launch-media-badges"><span class="home-launch-media-package"></span></div></div>
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
      ${progressMarkup}
      <div class="home-launch-meta"><span>${escapeHtml(ageLabel)}</span></div>
      ${footerNote ? `<small class="home-launch-evidence">${escapeHtml(footerNote)}</small>` : ''}
      <div class="home-launch-card-actions">${socialLinks}${tokenCardShareMarkup(item.address, item.symbol, item.name)}<button type="button" class="token-card-action-boost" data-boost-mint="${escapeHtml(item.address || '')}" aria-label="Boost ${escapeHtml(item.symbol || 'token')}">${icon('boost')}<span>Boost</span></button>${extraActions}</div>
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
