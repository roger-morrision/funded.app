import { escapeHtml, formatDashboardUsd, formatCompactUsd } from '../shared/display.js';
import { activeBoostMultiplier } from '../../../boost-offer.js';
import { boostPackageBadgesMarkup } from '../../../boost-card-badges.js';
import { icon } from '../../../ui-icons.js';
import { marketFreshness, marketFacts } from '../explore/market-facts.js';
import { compactLaunchCard } from './compact-launch-card.js';

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
  // The remaining 20% is the protocol share: referrals, daily bonuses,
  // community rewards and $RICH buyback.
  recipients.push('Rewards & buyback 20%');
  const summary = `Trading fees: ${recipients.join(' · ')}`;
  return `<div class="home-launch-fee-route" title="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}"><small>Fees</small><span>${recipients.map(escapeHtml).join(' · ')}</span></div>`;
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

// Unknown figures render as one muted dash, not "$—", so empty cards read as pending rather than broken.
function unknownStatMarkup(value) {
  return value === '$—' || value === '—' ? '<strong class="is-unknown" title="Not reported yet">—</strong>' : '';
}

export function launchCardProgressState(item, providerStatus = '') {
  const migrated = item.migrated === true, complete = item.complete === true;
  const loading = providerStatus === 'On-chain only · loading';
  const stale = /\bstale\b/i.test(String(providerStatus));
  // A curve percentage is shown only when Explore computed it from Pump's global
  // initial real token reserves (curveProgressBasis 'pump-global').
  const raw = item.curveProgressBasis === 'pump-global' && typeof item.curveProgressPercent === 'number' ? item.curveProgressPercent : NaN;
  const curvePercent = item.complete === false && !migrated && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
  const value = migrated || complete ? 100 : curvePercent;
  const stage = migrated ? 'Migrated' : complete ? 'Curve complete' : item.complete === false ? 'On curve' : '';
  // Migration is final, so a migrated coin never needs a "Last verified" caveat.
  const retained = !migrated && (stale || (loading && value !== null));
  const text = migrated ? 'Migrated' : complete ? 'Curve complete · Migration not yet verified'
    : item.complete === false ? (loading ? 'On curve · Checking progress…' : curvePercent != null ? `${curvePercent < 1 && curvePercent > 0 ? '<1' : Math.floor(curvePercent)}% to migration` : 'On curve')
      : loading ? 'Checking progress…' : 'Progress unavailable';
  // The current real/virtual ratio has no admitted per-mint starting basis, so a known
  // curve stage shows alone instead of repeating "Progress unavailable" on every card.
  return {
    kind: retained ? 'stale' : migrated ? 'migrated' : complete ? 'complete' : loading ? 'loading' : 'unavailable',
    value,
    text: `${retained || (loading && stage && !migrated) ? 'Last verified · ' : ''}${text}`,
    stage: stage ? `${!migrated && (stale || loading) ? 'Last verified · ' : ''}${stage}` : '',
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
      const rows = [...document.querySelectorAll('#home-launch-grid .home-launch-card .home-launch-progress-row, #asset-grid .home-launch-card .home-launch-progress-row, #creator-launch-empty .home-launch-card .home-launch-progress-row')]
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
        if (row.dataset.progressState === 'migrated') continue;
        const value = row.querySelector('.home-launch-progress-heading > strong');
        if (!value) continue;
        const settled = value.textContent.replace('On curve · Checking progress…', 'On curve').replace('Checking progress…', 'Progress unavailable');
        const text = settled.startsWith('Last verified · ') ? settled : `Last verified · ${settled}`;
        if (value.textContent !== text) value.textContent = text;
        row.dataset.progressState = 'stale';
        const track = row.querySelector('.home-launch-progress[role="progressbar"]');
        if (track) track.setAttribute('aria-valuetext', text);
        const badge = row.parentElement.querySelector('.home-launch-media-stage');
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
  { volumeLabel, volumeValue, extraClass, extraActions, footerNote, compact = false },
  {
    verifiedBoosts,
    EXPLORE_CLUSTER,
    exploreProviderStatus = '',
    coinSolUsdPrice,
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
    promotionForMint = () => null,
    verifiedPaidListingPayment = () => null,
    formatVerifiedPercent = value => `${value}%`,
    sameTickerCount = () => 0,
    document = globalThis.document,
  } = {}
) {
    const change = item.change || '—';
    const changeValue = Number.parseFloat(change);
    const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
    const displayMarket = marketFacts(item, EXPLORE_CLUSTER);
    const progress = launchCardProgressState(displayMarket, exploreProviderStatus);
    const trackAttributes = progress.value === null ? 'aria-hidden="true"'
      : `role="progressbar" aria-label="Migration progress for ${escapeHtml(item.symbol || item.name || 'token')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.value)}" aria-valuetext="${escapeHtml(progress.text)}"`;
    const progressMarkup = EXPLORE_CLUSTER !== 'devnet' && progress.value === null ? '' : `<div class="home-launch-progress-row" data-progress-state="${progress.kind}"><div class="home-launch-progress-heading"><span>Bonding curve</span><strong>${escapeHtml(progress.text)}</strong></div><div class="home-launch-progress" ${trackAttributes}>${progress.value === null ? '' : `<i style="--launch-progress:${Number(progress.value.toFixed(2))}%"></i>`}</div></div>`;
    const ageLabel = item.createdTimestamp ? formatOnchainAge(Number(item.createdTimestamp) * 1000) : 'Age unavailable';
    const capSol = displayMarket.migrated === true ? displayMarket.poolMarketCapSol : displayMarket.curveCapSol;
    const capLabel = displayMarket.migrated === true ? 'Market cap' : 'Curve cap';
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
    if (compact) {
      const priceSol = displayMarket.migrated === true ? displayMarket.poolPriceSol : displayMarket.complete === false ? displayMarket.curvePriceSol : null;
      const usd = EXPLORE_CLUSTER === 'devnet' ? (Number.isFinite(priceSol) && Number.isFinite(coinSolUsdPrice) ? priceSol*coinSolUsdPrice : null) : item.priceUsd;
      const price = Number.isFinite(usd) && usd > 0 ? `$${usd.toLocaleString(undefined,{maximumSignificantDigits:4})}` : Number.isFinite(priceSol) && priceSol > 0 ? `${priceSol.toLocaleString(undefined,{maximumSignificantDigits:4})} SOL` : '—';
      const policy = verifiedLaunchPolicyForMint?.(item.address);
      const creator = policy?.onchainVerified ? policy.creatorWallet : item.creator;
      return compactLaunchCard(item,{value,ageLabel,price,creator:typeof creator==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(creator)?creator:null,
        progress,holderCount,holderTitle,boostMarkup:boostPackageBadgesMarkup(verifiedBoosts?.[item.address]),freshness:marketFreshness(item,EXPLORE_CLUSTER),socialMarkup:exploreSocialLinksMarkup(item),watchMarkup:tokenCardWatchMarkup(item.address,item.symbol)});
    }
    const launchPolicy = verifiedLaunchPolicyForMint(item.address);
    const mintLabel = item.address ? `${item.address.slice(0, 5)}…${item.address.slice(-4)}` : 'Unavailable';
    const feeRoute = homeLaunchFeeRouteMarkup(launchPolicy);
    // Protocol facts beside the launch package and boost: paid listing, $RICH
    // burned for this coin, and its airdrop to $RICH holders.
    const promotion = promotionForMint(item.address);
    const listing = verifiedPaidListingPayment(item);
    const burnedTokens = [promotion?.amountTokens, listing?.amountTokens]
      .map(Number).filter(amount => Number.isFinite(amount) && amount > 0).reduce((sum, amount) => sum + amount, 0);
    const airdropPercent = item.communityAirdropPercent == null ? null : formatVerifiedPercent(item.communityAirdropPercent);
    // Trust checks traders look for first, from confirmed mint data.
    const sameTicker = sameTickerCount(item);
    const trustChips = [
      sameTicker > 0 ? `<span class="home-launch-chip is-warning" title="Check the contract address before buying">⚠ ${sameTicker} other coin${sameTicker === 1 ? ' uses' : 's use'} $${escapeHtml(item.symbol || '')}</span>` : '',
    ].join('');
    const protocolChips = trustChips + [
      listing ? `<span class="home-launch-chip is-listed" title="Paid listing confirmed on Solana">${icon('listingBag')}Listed</span>` : '',
      burnedTokens ? `<span class="home-launch-chip is-burn" title="$RICH burned for this coin's launch package and listing">${icon('burn')}${escapeHtml(burnedTokens.toLocaleString())} $RICH burned</span>` : '',
      airdropPercent ? `<span class="home-launch-chip is-airdrop" title="Share of this coin's supply reserved for $RICH holders">${icon('send')}${escapeHtml(airdropPercent)} to $RICH holders</span>` : '',
    ].join('');
    const socialLinks = exploreSocialLinksMarkup(item);
    const boost = verifiedBoosts[item.address];
    const boostMultiplier = activeBoostMultiplier(boost);
    const activeBoost = boostMultiplier > 0;
    // One card layout for every token list (Home, Explore, Favorites, Following,
    // Portfolio): identity and socials up top, market figures, curve, then actions.
    // "No trades" lives in the volume cell only; repeating it beside the cap clipped the cap on phones.
    return `<article class="token-card-shell home-launch-card${extraClass}" data-mint="${escapeHtml(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}">
      <a class="home-launch-card-link" href="/token/${encodeURIComponent(item.address || '')}" aria-label="Open ${escapeHtml(item.name || item.symbol || 'token')} token details"></a>
      <div class="home-card-overview">
      <div class="home-launch-card-media"><span class="home-token-avatar">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}${EXPLORE_CLUSTER !== 'devnet' && /^https:\/\//.test(String(item.imageUri || '')) ? `<img src="${escapeHtml(item.imageUri)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span></div>
      <div class="home-card-info">
        <div class="home-card-heading">
          <span class="home-token-identity"><strong class="${activeBoost && boostMultiplier >= 500 ? 'golden-ticker' : ''}">${escapeHtml(item.symbol || 'TOKEN')}${activeBoost ? ` ${boostPackageBadgesMarkup(boost)}` : ''}</strong><small>${escapeHtml(item.name || 'Unnamed token')}</small></span>
        </div>
        <div class="home-card-meta">
          ${item.createdTimestamp ? `<span class="home-launch-age">${escapeHtml(ageLabel)}</span>` : ''}
          <span class="home-launch-card-addresses" title="Token contract: ${escapeHtml(item.address || '')}"><code>${escapeHtml(mintLabel)}</code><button type="button" class="home-launch-copy-address" data-copy-address="${escapeHtml(item.address || '')}" data-copy-kind="token" aria-label="Copy full token address" title="Copy full token address">${icon('copy')}</button></span>
          ${socialLinks}
        </div>
      </div>
      <div class="home-card-star">${tokenCardWatchMarkup(item.address, item.symbol)}</div>
      </div>
      <div class="home-launch-card-stats">
                    <span class="home-launch-cap"><small>${EXPLORE_CLUSTER === 'devnet' ? capLabel : 'Market cap'}</small>${unknownStatMarkup(value) || `<strong>${escapeHtml(value)}${changeClass ? ` <span class="home-launch-change ${changeClass}" title="${escapeHtml(volumeLabel)} change">${escapeHtml(change)}</span>` : ''}</strong>`}</span>
                    <span><small>${escapeHtml(volumeLabel)} volume</small>${unknownStatMarkup(shownVolume) || `<strong>${escapeHtml(shownVolume)}</strong>`}</span>
                    <span title="${escapeHtml(holderTitle)}"><small>Holders</small>${unknownStatMarkup(holderCount) || `<strong>${escapeHtml(holderCount)}</strong>`}</span>
                    ${progressMarkup}
                    <div class="home-launch-protocol" aria-label="richpad.fun launch details">
                      <span class="home-launch-media-package"></span>
                      ${exploreBoostAmountMarkup(item.address)}
                      ${protocolChips}
                    </div>
                  </div>
                  ${feeRoute || footerNote ? `<div class="home-card-market-summary">${feeRoute}${footerNote ? `<small class="home-launch-note">${escapeHtml(footerNote)}</small>` : ''}</div>` : ''}
            <div class="home-launch-card-actions has-buy-presets">${['0.2','0.5','1'].map(amount => `<a class="card-review-buy" data-review-buy="${escapeHtml(item.address || '')}" data-review-amount="${amount}" data-symbol="${escapeHtml(item.symbol || '')}" data-dex="${escapeHtml(item.dexId || '')}" href="/token/${encodeURIComponent(item.address || '')}?reviewBuy=${amount}" title="Review a ${amount} SOL buy">Buy ${amount} SOL</a>`).join('')}${tokenCardShareMarkup(item.address, item.symbol, item.name)}<button type="button" class="token-card-action-boost" data-boost-mint="${escapeHtml(item.address || '')}" aria-label="Boost ${escapeHtml(item.symbol || 'token')}" title="Boost">${icon('boost')}<span>Boost</span></button>${extraActions}</div>
    </article>`;
}

export function decorateHomeLaunchCard(
  card,
  mint,
  {},
  {
    promotionElement,
    promotionForMint,
  } = {}
) {
  const packageBadge = card.querySelector('.home-launch-media-package');
  packageBadge?.replaceChildren();
  const promotion = promotionElement(mint, true);
  if (promotion) {
    const launchPromotion = promotionForMint(mint);
    if (launchPromotion?.tier === 'boost') promotion.textContent = `Boost · ${launchPromotion.amountTokens.toLocaleString()} $RICH`;
    packageBadge?.append(promotion);
  }
}
