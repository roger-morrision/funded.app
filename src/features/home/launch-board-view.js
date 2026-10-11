import { withMarketWindow } from '../../../market-intelligence.js';
import { formatCompactUsd, escapeHtml } from '../shared/display.js';
import { activeBoostPackages, activeBoostMultiplier } from '../../../boost-offer.js';
import { matchesHomeLaunchFilters, homeLaunchFilterCount } from '../../../home-launch-filters.js';

// Render current data; the application owns pagination and paused-order state.
export function renderHomeLaunchBoard(state, {
  verifiedLaunchPolicyForMint,
  withVerifiedExploreBenefits,
  launchCardVolumeUsd,
  exploreBoostAmountMarkup,
  setupHomeTicker,
  getWatchlist,
  promotionForMint,
  formatCoinUsd,
  loadVerifiedTokenLogos,
  homeLaunchCardMarkup,
  decorateHomeLaunchCard,
  document = globalThis.document,
}) {
  const {
    homeLaunchView,
    exploreFeedAvailable,
    exploreLastVerifiedAt,
    homeLaunchWindow,
    assets,
    homeFeeAmounts,
    coinSolUsdPrice,
    homeLaunchSort,
    verifiedBoosts,
    homeLaunchTab,
    homeLaunchFilters,
    homeLaunchPaused,
    exploreProviderStatus,
    EXPLORE_CLUSTER,
  } = state;
  const grid = document.querySelector('#home-launch-grid');
  if (!grid) return;
  const tableWrap = document.querySelector('#home-launch-table-wrap');
  const tableBody = document.querySelector('#home-launch-table-body');
  grid.hidden = homeLaunchView === 'table';
  if (tableWrap) tableWrap.hidden = homeLaunchView !== 'table';
  const feedState = document.querySelector('#home-feed-state');
  if (feedState) {
    feedState.hidden = exploreFeedAvailable;
    feedState.textContent = exploreFeedAvailable ? `Feed available`
      : exploreLastVerifiedAt ? 'Last verified snapshot' : 'Feed unavailable';
    feedState.dataset.state = exploreFeedAvailable ? 'live' : exploreLastVerifiedAt ? 'snapshot' : 'unavailable';
  }
  const tickerLabel = document.querySelector('#home-market-ticker-label');
  if (tickerLabel) tickerLabel.textContent = 'Latest launches';
  const volumeFilterLabel = document.querySelector('#home-filter-volume-label');
  if (volumeFilterLabel?.firstChild) volumeFilterLabel.firstChild.textContent = `${homeLaunchWindow} volume `;
  const tradesFilterLabel = document.querySelector('#home-filter-trades-label');
  if (tradesFilterLabel) tradesFilterLabel.textContent = `${homeLaunchWindow} trades`;
  if (EXPLORE_CLUSTER !== 'devnet') document.querySelectorAll('[data-home-window]').forEach(button => {
    button.disabled = button.dataset.homeWindow !== '24h';
    if (button.disabled) button.title = 'Shorter indexed volume windows are unavailable on this feed';
  });
  const verified = assets.filter(item => verifiedLaunchPolicyForMint(item.address))
    .map(item => {
      const raw = homeFeeAmounts.get(item.address);
      const lamports = /^\d+$/.test(raw || '') ? Number(raw) : NaN;
      if (Number.isSafeInteger(lamports)) item.collectedCreatorFeesSol = lamports / 1_000_000_000;
      return withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, homeLaunchWindow) : item);
    });
  const volumeRank = item => {
    const observed = EXPLORE_CLUSTER === 'devnet' ? item.windowVolumeSol : homeLaunchWindow === '24h' ? item.volume24hUsd : null;
    if (observed == null || observed === '') return -1;
    const value = Number(observed);
    return Number.isFinite(value) && value >= 0 ? value : -1;
  };
  const capUsd = item => {
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    const observed = EXPLORE_CLUSTER === 'devnet'
      ? capSol == null || !Number.isFinite(coinSolUsdPrice) ? null : Number(capSol) * coinSolUsdPrice
      : item.marketCapUsd;
    const value = observed == null || observed === '' ? NaN : Number(observed);
    return Number.isFinite(value) && value >= 0 ? value : -1;
  };
  const volumeUsd = item => launchCardVolumeUsd(item, homeLaunchWindow);
  const ticker = document.querySelector('#home-market-ticker-items');
  const tableVolumeHeading = document.querySelector('#home-table-volume-heading');
  const tableTxnsHeading = document.querySelector('#home-table-txns-heading');
  const tableMcHeading = document.querySelector('#home-table-mc-heading');
  if (tableMcHeading) tableMcHeading.setAttribute('aria-sort', homeLaunchSort === 'market-cap' ? 'descending' : 'none');
  const pauseButton = document.querySelector('#home-feed-pause');
  if (pauseButton) {
    pauseButton.disabled = homeLaunchSort === 'market-cap';
    if (pauseButton.disabled) pauseButton.title = 'Market-cap order is static';
  }
  if (tableVolumeHeading) {
    tableVolumeHeading.textContent = 'Volume';
    tableVolumeHeading.title = `${homeLaunchWindow} observed volume`;
  }
  if (tableTxnsHeading) {
    tableTxnsHeading.textContent = 'Txns';
    tableTxnsHeading.title = `${homeLaunchWindow} observed transactions`;
  }
  if (ticker) {
    const ranked = [...verified]
      .sort((a, b) => volumeRank(b) - volumeRank(a)).slice(0, 6);
    const tickerMarkup = ranked.length ? ranked.map((item, index) => {
      const currentCap = capUsd(item);
      const marketCap = currentCap >= 0 ? formatCompactUsd(currentCap) : '$—';
      const windowActivity = item.activityWindows?.[homeLaunchWindow];
      const sinceFirstTrade = EXPLORE_CLUSTER === 'devnet' && windowActivity?.coverage === 'complete'
        && windowActivity.priceChangeBasis === 'since-first-trade';
      const changeValue = EXPLORE_CLUSTER === 'devnet'
        ? item.windowPriceChangePercent ?? (sinceFirstTrade ? windowActivity.priceChangePercent : null)
        : item.priceChange24hPercent;
      const hasChange = changeValue != null && Number.isFinite(Number(changeValue));
      const change = hasChange ? `${Number(changeValue) >= 0 ? '+' : ''}${Number(changeValue).toFixed(2)}%` : '—';
      const trendClass = hasChange ? Number(changeValue) >= 0 ? 'is-positive' : 'is-negative' : '';
      const changeLabel = sinceFirstTrade && item.windowPriceChangePercent == null
        ? 'Market cap change since first recorded trade'
        : `${homeLaunchWindow} market cap change`;
      const symbol = item.symbol || 'TOKEN';
      const boost = verifiedBoosts[item.address];
      const boostMultiplier = activeBoostMultiplier(boost);
      const boostPacks = activeBoostPackages(boost);
      const boostQuantity = boostMultiplier ? boostPacks.length || Math.max(1, Number(boost?.count) || 0) : 0;
      const boostDetail = boostQuantity ? `${boostQuantity} active boost${boostQuantity === 1 ? '' : 's'} · ${boostMultiplier.toLocaleString()}x total` : '';
      const detail = `${symbol}${boostDetail ? ` · ${boostDetail}` : ''} · ${changeLabel} ${change} · ${item.migrated === true ? 'pool' : 'curve'} MC ${marketCap}`;
      return `<a href="/token/${encodeURIComponent(item.address || '')}" data-logo-mint="${escapeHtml(item.address || '')}" aria-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}"><span class="home-ticker-rank" aria-hidden="true">${index + 1}</span><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon || String(symbol).slice(0, 1))}</span><strong class="${boostMultiplier >= 500 ? 'golden-ticker' : ''}">${escapeHtml(symbol)}</strong>${boostQuantity ? `<span class="home-ticker-boost" title="${escapeHtml(boostDetail)}" aria-label="${escapeHtml(boostDetail)}">⚡${boostMultiplier.toLocaleString()}</span>` : ''}<span class="home-ticker-change ${trendClass}" title="${escapeHtml(hasChange ? changeLabel : 'Market cap change unavailable')}">${escapeHtml(change)}</span><small class="home-ticker-mc">MC ${escapeHtml(marketCap)}</small></a>`;
    }).join('') : `<span class="home-ticker-empty">${exploreFeedAvailable ? `No verified ${escapeHtml(homeLaunchWindow)} trades in this feed` : exploreProviderStatus === 'On-chain only · loading' ? 'Checking verified market activity' : 'Market activity unavailable'}</span>`;
    setupHomeTicker(ticker, tickerMarkup, ranked.length);
  }
  let visible = [...verified];
  if (homeLaunchTab === 'curve') visible = visible.filter(item => item.migrated !== true && item.complete === false);
  else if (homeLaunchTab === 'migrated') visible = visible.filter(item => item.migrated === true);
  else if (homeLaunchTab === 'watchlist') visible = visible.filter(item => getWatchlist().includes(item.address));
  else if (homeLaunchTab === 'promoted') visible = visible.filter(item => Boolean(promotionForMint(item.address) || verifiedBoosts[item.address]));
  else if (homeLaunchTab === 'boost') visible = visible.filter(item => activeBoostMultiplier(verifiedBoosts[item.address]) > 0);
  else if (['standard', 'pro', 'premier'].includes(homeLaunchTab)) visible = visible.filter(item => (promotionForMint(item.address)?.tier || 'standard') === homeLaunchTab && !verifiedBoosts[item.address]);
  visible = visible.filter(item => matchesHomeLaunchFilters(item, homeLaunchFilters, { cluster: EXPLORE_CLUSTER, solUsdPrice: coinSolUsdPrice }));
  visible.sort((a, b) => (homeLaunchSort === 'market-cap' ? capUsd(b) - capUsd(a)
    : (verifiedBoosts[b.address]?.multiplier || 0) - (verifiedBoosts[a.address]?.multiplier || 0) || volumeRank(b) - volumeRank(a))
    || Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  if (homeLaunchPaused) {
    if (!state.homeFrozenOrder) state.homeFrozenOrder = visible.map(item => item.address);
    const frozenRank = new Map(state.homeFrozenOrder.map((mint, index) => [mint, index]));
    visible.sort((a, b) => (frozenRank.get(a.address) ?? Infinity) - (frozenRank.get(b.address) ?? Infinity));
  }
  // Show every verified launch; the volume window only changes metrics and ordering.
  const boardCount = document.querySelector('#home-board-count');
  if (boardCount) boardCount.textContent = visible.length ? `Showing ${visible.length} verified coin${visible.length === 1 ? '' : 's'}` : '';
  if (!visible.length) {
    const feedUnavailable = (!exploreFeedAvailable && !exploreLastVerifiedAt)
      || /RPC (?:rate limited|unavailable)/i.test(exploreProviderStatus);
    const title = feedUnavailable ? 'Tokens are temporarily unavailable.' : homeLaunchTab === 'watchlist' ? 'No favorite tokens yet.' : homeLaunchFilterCount(homeLaunchFilters) ? 'No launches match these filters.' : 'No verified launches in this view.';
    const detail = feedUnavailable ? 'Current Solana mint and market checks could not finish. Recorded reward and airdrop policies remain visible in their own sections.' : homeLaunchTab === 'watchlist' ? 'Add a verified token from Explore to see it here.' : 'Try another view or adjust the filters.';
    grid.innerHTML = `<div class="empty-state"><strong>${title}</strong><span>${detail}</span>${feedUnavailable ? '<button type="button" class="secondary-button" data-verified-feed-retry>Try again</button>' : ''}</div>`;
    if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="home-table-empty"><strong>${title}</strong><span>${detail}</span>${feedUnavailable ? '<button type="button" class="secondary-button" data-verified-feed-retry>Try again</button>' : ''}</td></tr>`;
    return;
  }
  if (tableBody) {
    tableBody.innerHTML = visible.map(item => {
      const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
      const cap = EXPLORE_CLUSTER === 'devnet' ? formatCoinUsd(capSol) : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : '—';
      const tier = promotionForMint(item.address)?.tier || 'standard';
      const change = item.change || '—';
      const changeValue = Number.parseFloat(change);
      const trendClass = Number.isFinite(changeValue) ? changeValue >= 0 ? 'is-positive' : 'is-negative' : '';
      const observedTrades = EXPLORE_CLUSTER === 'devnet' ? item.windowTradeCount : item.tradeCount24h;
      const trades = observedTrades != null && Number.isInteger(Number(observedTrades)) && Number(observedTrades) >= 0
        ? `${EXPLORE_CLUSTER === 'devnet' && item.windowCoverage === 'partial' ? '≥' : ''}${Number(observedTrades).toLocaleString()}` : '—';
      const progress = item.curveProgressPercent == null ? NaN : Number(item.curveProgressPercent);
      const curve = item.migrated === true ? 'Migrated' : item.complete === true ? 'Curve complete'
        : Number.isFinite(progress) ? `${Math.round(Math.max(0, Math.min(100, progress)))}%` : '—';
      const shownChange = change;
      return `<tr><td><a class="home-table-coin" data-logo-mint="${escapeHtml(item.address || '')}" href="/token/${encodeURIComponent(item.address || '')}"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(item.icon || String(item.symbol || 'T').slice(0, 1))}</span><span><strong>${escapeHtml(item.symbol || 'TOKEN')}</strong>${exploreBoostAmountMarkup(item.address)}<small>${escapeHtml(item.name || 'Unnamed token')}</small></span></a></td><td><span class="home-table-tier" data-tier="${tier}">${escapeHtml(tier.charAt(0).toUpperCase() + tier.slice(1))}</span></td><td>${escapeHtml(cap)}</td><td>${escapeHtml(volumeUsd(item))}</td><td>${escapeHtml(trades)}</td><td class="${trendClass}">${escapeHtml(shownChange)}</td><td><span class="home-table-curve">${escapeHtml(curve)}</span></td></tr>`;
    }).join('');
    loadVerifiedTokenLogos(tableBody);
  }
  grid.innerHTML = visible.map(item => homeLaunchCardMarkup(item, { volumeLabel: homeLaunchWindow, volumeValue: volumeUsd(item) })).join('');
  grid.querySelectorAll('.home-launch-card').forEach((card, index) => decorateHomeLaunchCard(card, visible[index]?.address));
  loadVerifiedTokenLogos(grid);
}
