import { withMarketWindow, enrichMarketRecord, summarizeMarkets, formatSignal, sortMarketRecords } from '../../../market-intelligence.js';
import { escapeHtml } from '../shared/display.js';
import { activeBoostMultiplier } from '../../../boost-offer.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderExploreAssets(
  { force },
  {
    exploreProviderStatus,
    exploreLastVerifiedAt,
    exploreFeedAvailable,
    assets,
    exploreWindow,
    exploreScannedCount,
    verifiedBoosts,
    exploreTab,
    EXPLORE_CLUSTER,
  },
  {
    exploreOutageCopy,
    withVerifiedExploreBenefits,
    filterExploreTabRecords,
    renderExploreControls,
    renderExplorePulse,
    renderExploreBenefitLeaders,
    formatExploreUsd,
    exploreBoostAmountMarkup,
    exploreStageLabel,
    loadVerifiedTokenLogos,
    homeLaunchCardMarkup,
    launchCardVolumeUsd,
    exploreEmptyReason,
    decorateHomeLaunchCard,
    renderWatchlist,
    renderWalletDetail,
    document = globalThis.document,
  } = {}
) {
  const grid = document.querySelector('#asset-grid');
  // Preserve the focused action through background market refreshes.
  if (!force && grid?.contains(document.activeElement)) {
    grid.dataset.refreshPending = 'true';
    return;
  }
  if (grid) delete grid.dataset.refreshPending;
  const status = document.querySelector('#explore-data-status');
  const ticker = document.querySelector('#explore-ticker');
  const clusterLabel = document.querySelector('#explore-cluster-label');
  const scope = document.querySelector('.explore-hero-disclosure');
  const loading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt;
  const feedUnavailable = !exploreFeedAvailable && !exploreLastVerifiedAt;
  const rpcUnavailable = /RPC (?:rate limited|unavailable)/.test(exploreProviderStatus);
  const outage = exploreOutageCopy();
  const loaded = !loading && exploreFeedAvailable && !rpcUnavailable && !/stale|unavailable|rate limited/i.test(exploreProviderStatus);
  if (clusterLabel) clusterLabel.hidden = loaded;
  if (status) {
    status.hidden = loaded;
    const badge = status.closest('.live-label');
    if (badge) badge.hidden = loaded;
  }
  if (clusterLabel) clusterLabel.textContent = `${exploreProviderStatus.includes('Verified launch registry') ? 'Verified launch registry' : exploreProviderStatus.includes('stale') ? 'last verified snapshot' : exploreProviderStatus.includes('RPC verified') ? 'RPC verified' : exploreProviderStatus.includes('unavailable') ? 'data unavailable' : 'awaiting verification'}`;
  if (scope && EXPLORE_CLUSTER !== 'devnet') scope.textContent = 'Solana mainnet discovery · Pump.fun listings are shown only after mint verification. Missing market figures stay unavailable.';
  const records = assets.map(item => withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(item, exploreWindow) : enrichMarketRecord(item)));
  const visible = filterExploreTabRecords(records);
  renderExploreControls();
  renderExplorePulse(records);
  renderExploreBenefitLeaders(visible);
  const summary = summarizeMarkets(records);
  if (status) status.textContent = exploreProviderStatus === 'On-chain only · loading' ? exploreProviderStatus : `${exploreProviderStatus}${assets.length ? ` · ${visible.length} shown` : ''}`;
  const kpis = document.querySelector('#explore-market-kpis');
  if (kpis) kpis.innerHTML = EXPLORE_CLUSTER === 'devnet'
    ? `<span><small>${exploreWindow} curve traded · scanned</small><strong>${formatExploreUsd(records.some(item => item.windowVolumeSol != null) ? records.reduce((sum, item) => sum + (item.windowVolumeSol || 0), 0) : null, { partial: exploreScannedCount < records.length || records.some(item => item.windowCoverage === 'partial') })}</strong></span><span><small>On-chain reserves</small><strong>${formatExploreUsd(records.some(item => (item.migrated === true ? item.poolReserveSol : item.curveReserveSol) != null) ? records.reduce((sum, item) => sum + (item.migrated === true ? item.poolReserveSol : item.curveReserveSol || 0), 0) : null)}</strong></span><span><small>Curve histories scanned</small><strong>${exploreScannedCount} / ${records.length}</strong></span>`
    : `<span><small>24h volume</small><strong>${formatSignal(summary.volume24hUsd, ' USD')}</strong></span><span><small>Liquidity indexed</small><strong>${formatSignal(summary.liquidityUsd, ' USD')}</strong></span><span><small>High-risk signals</small><strong>${summary.highRisk}</strong></span>`;
  if (ticker) {
    const trending = sortMarketRecords(records.filter(asset => EXPLORE_CLUSTER === 'devnet'
      ? asset.windowVolumeSol != null && Number.isFinite(Number(asset.windowVolumeSol))
      : asset.volume24hUsd != null && Number.isFinite(Number(asset.volume24hUsd))), 'volume').slice(0, 8);
    if (trending.length) {
      const tickerItems = trending.map(asset => `<a class="explore-ticker-token" data-logo-mint="${escapeHtml(asset.address || '')}" href="/token/${encodeURIComponent(asset.address || '')}"><i>${escapeHtml(String(asset.symbol || 'T').slice(0, 1))}</i><span><span class="explore-ticker-primary"><strong class="${activeBoostMultiplier(verifiedBoosts[asset.address]) >= 500 ? 'golden-ticker' : ''}">${escapeHtml(asset.symbol || 'TOKEN')}</strong>${exploreBoostAmountMarkup(asset.address)}</span><small>${escapeHtml(asset.name || asset.symbol)} · ${escapeHtml(exploreStageLabel(asset))}</small></span><b>${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(asset.windowVolumeSol, { partial: asset.windowCoverage === 'partial' }) : formatSignal(asset.volume24hUsd, ' USD'))}</b></a>`).join('');
      ticker.innerHTML = `<div class="explore-ticker-heading"><span class="ticker-label"><i></i> Trending</span><button type="button" class="explore-ticker-view-all">View all</button></div><div class="explore-ticker-window" aria-label="Tokens ranked by verified ${escapeHtml(exploreWindow)} traded volume"><div class="explore-ticker-track"><div class="explore-ticker-set">${tickerItems}</div></div></div>`;
      loadVerifiedTokenLogos(ticker);
    } else {
      ticker.innerHTML = `<div class="explore-ticker-heading"><span class="ticker-label"><i></i> Trending</span><button type="button" class="explore-ticker-view-all">View all</button></div><span id="explore-ticker-status">${loading ? 'Loading verified launches…' : feedUnavailable || rpcUnavailable ? escapeHtml(outage.title) : 'No scanned volume yet'}</span>`;
    }
  }
  if (!grid) return;
  grid.innerHTML = visible.length ? visible.map(item => homeLaunchCardMarkup(item, {
    volumeLabel: exploreWindow,
    volumeValue: launchCardVolumeUsd(item, exploreWindow),
    extraClass: ' explore-launch-card',
  })).join('') : loading
    ? '<div class="empty-state onchain-empty"><strong>Loading verified launches…</strong><span>Checking the indexed launch feed and confirming current Solana state.</span></div>'
    : feedUnavailable || rpcUnavailable
      ? `<div class="empty-state onchain-empty"><strong>${escapeHtml(outage.title)}</strong><span>${escapeHtml(outage.detail)}</span></div>`
        : `<div class="empty-state onchain-empty"><strong>${assets.length ? 'No verified launches match these filters.' : exploreProviderStatus.includes('none passed RPC verification') ? 'Token details could not be confirmed.' : 'No tokens to show yet.'}</strong><span>${assets.length ? 'Broaden the search or clear the filters.' : exploreProviderStatus.includes('none passed RPC verification') ? 'We could not confirm these tokens on Solana. Try again shortly.' : 'Confirmed launches will appear here when available.'}</span></div>`;
  if (!visible.length && assets.length && !feedUnavailable && !rpcUnavailable) {
    const reason = exploreEmptyReason();
    if (reason) { grid.querySelector('.empty-state strong').textContent = reason[0]; grid.querySelector('.empty-state span').textContent = reason[1]; }
  }
  grid.querySelectorAll('.explore-launch-card').forEach((card, index) => decorateHomeLaunchCard(card, visible[index]?.address));
  loadVerifiedTokenLogos(grid);
  if (!visible.length && !loading) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'explore-empty-action';
    action.dataset.exploreEmptyAction = assets.length ? 'clear' : 'retry';
    action.textContent = assets.length ? ['new', 'following', 'favorites'].includes(exploreTab) ? 'View all tokens' : 'Clear filters' : 'Try again';
    grid.querySelector('.empty-state')?.append(action);
  }
  renderWatchlist();
  renderWalletDetail();
}
