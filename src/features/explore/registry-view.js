import { paginateExploreRows, explorePageNumbers } from '../../../explore-pagination.js';
import { escapeHtml, formatCompactUsd } from '../shared/display.js';
import { activeBoostMultiplier } from '../../../boost-offer.js';
import { icon } from '../../../ui-icons.js';

// Render current data; the application owns pagination and paused-order state.
export function renderRegistry(query, state, {
  getWatchlist,
  filterExploreTabRecords,
  exploreOutageCopy,
  exploreEmptyReason,
  exploreStageLabel,
  formatOnchainAge,
  explorePaidListingBagMarkup,
  exploreBoostAmountMarkup,
  exploreSocialLinksMarkup,
  exploreTierBadgeMarkup,
  exploreMarketCapUsd,
  formatExploreTradeCount,
  formatExploreUsd,
  exploreAirdropMarkup,
  loadVerifiedTokenLogos,
  renderWatchlist,
  document = globalThis.document,
}) {
  const {
    exploreSort,
    exploreRisk,
    exploreStage,
    exploreAuthority,
    explorePromotion,
    exploreReward,
    exploreTab,
    exploreNewLane,
    exploreWindow,
    exploreMaxAgeHours,
    exploreMinVolumeUsd,
    exploreMinMarketCapUsd,
    exploreMinTrades,
    exploreMinTraders,
    registryLaunches,
    exploreProviderStatus,
    exploreLastVerifiedAt,
    assets,
    exploreFeedAvailable,
    verifiedBoosts,
    EXPLORE_CLUSTER,
  } = state;
  const criteriaKey = JSON.stringify([query, exploreSort, exploreRisk, exploreStage, exploreAuthority,
    explorePromotion, exploreReward, exploreTab, exploreNewLane, exploreWindow, exploreMaxAgeHours,
    exploreMinVolumeUsd, exploreMinMarketCapUsd, exploreMinTrades, exploreMinTraders, getWatchlist()]);
  if (criteriaKey !== state.registryCriteriaKey) { state.registryPage = 1; state.registryCriteriaKey = criteriaKey; }
  const filtered = filterExploreTabRecords(registryLaunches, query);
  const page = paginateExploreRows(filtered, state.registryPage);
  state.registryPage = page.page;
  const registryLoading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt;
  const registryUnavailable = !registryLoading && !assets.length && ((!exploreFeedAvailable && !exploreLastVerifiedAt) || /RPC (?:rate limited|unavailable)/i.test(exploreProviderStatus));
  const outage = exploreOutageCopy();
  const count = document.querySelector('#scanner-count');
  if (count) count.textContent = registryLoading ? 'Checking launches' : registryUnavailable ? outage.title : `${filtered.length} of ${registryLaunches.length} shown`;
  const range = document.querySelector('#scanner-range');
  if (range) range.textContent = registryLoading ? 'Loading' : registryUnavailable ? 'Unavailable' : page.total ? `${page.start + 1}–${page.end} of ${page.total} launches` : '0 launches';
  const pageLabel = document.querySelector('#scanner-page-label');
  if (pageLabel) pageLabel.textContent = `Page ${page.page} of ${page.pages}`;
  const pagination = document.querySelector('#scanner-pagination');
  if (pagination) {
    pagination.hidden = page.pages <= 1;
    pagination.querySelector('[data-registry-page="prev"]').disabled = page.page <= 1;
    pagination.querySelector('[data-registry-page="next"]').disabled = page.page >= page.pages;
    const numbers = pagination.querySelector('#scanner-page-numbers');
    if (numbers) numbers.innerHTML = explorePageNumbers(page.page, page.pages).map(number => `<button type="button" data-registry-page="${number}" aria-label="Page ${number}" ${number === page.page ? 'aria-current="page"' : ''}>${number}</button>`).join('');
  }
  const list = document.querySelector('#launch-list');
  if (!list) return;
  if (!filtered.length) {
    const reason = exploreEmptyReason();
    list.innerHTML = registryLoading
      ? '<div class="empty-state">Checking the verified launch feed…</div>'
      : registryUnavailable
      ? `<div class="empty-state"><strong>${escapeHtml(outage.title)}</strong><span>${escapeHtml(outage.detail)}</span><button type="button" class="secondary-button" data-verified-feed-retry>Try again</button><a class="explore-policy-link" href="#airdrops">Browse recorded airdrop policies →</a></div>`
      : `<div class="empty-state">${escapeHtml(reason?.[0] || 'No verified launches match these filters.')} ${escapeHtml(reason?.[1] || 'Try All stages or clear the search.')}</div>`;
    return;
  }
  list.innerHTML = page.rows.map((item, index) => {
    const mint = escapeHtml(item.address);
    const symbol = escapeHtml(item.symbol);
    const stage = exploreStageLabel(item);
    const age = item.createdTimestamp ? escapeHtml(formatOnchainAge(Number(item.createdTimestamp) * 1000)) : 'Age unavailable';
    const change = item.priceChange24hPercent == null ? '—' : `${item.priceChange24hPercent >= 0 ? '+' : ''}${Number(item.priceChange24hPercent).toFixed(2)}%`;
    return `<div class="scanner-row" role="row" data-logo-mint="${mint}">
      <span class="scanner-rank" role="cell">${page.start + index + 1}</span>
      <div class="scanner-token" role="cell"><span class="asset-icon">${escapeHtml(item.icon)}</span><span><span class="scanner-token-heading"><a class="scanner-token-link" href="/token/${encodeURIComponent(item.address)}"><strong class="${activeBoostMultiplier(verifiedBoosts[item.address]) >= 500 ? 'golden-ticker' : ''}">${symbol} <small>${escapeHtml(item.name)}</small></strong></a>${explorePaidListingBagMarkup(item)}${exploreBoostAmountMarkup(item.address)}</span><span class="scanner-actions"><button type="button" class="copy-row scanner-contract" data-mint="${mint}" aria-label="Copy ${symbol} token contract address" title="Copy full contract address: ${mint}"><span>${escapeHtml(`${item.address.slice(0, 4)}…${item.address.slice(-4)}`)}</span>${icon('copy')}</button>${exploreSocialLinksMarkup(item)}<button type="button" class="watch-button scanner-watch" data-mint="${mint}" aria-label="Add ${symbol} to favorites" aria-pressed="false" title="Add to favorites">${icon('star')}</button></span></span></div>
      <div class="scanner-tier" role="cell">${exploreTierBadgeMarkup(item.address)}</div>
      <span class="scanner-metric" role="cell">${escapeHtml(exploreMarketCapUsd(item))}</span>
      <span class="scanner-age" role="cell">${age}</span>
      <span class="scanner-metric" role="cell" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)}</span>
      <span class="scanner-metric" role="cell" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(item.windowVolumeSol, { partial: item.windowCoverage === 'partial' }) : formatCompactUsd(item.volume24hUsd))}</span>
      <span class="scanner-metric ${Number(item.priceChange24hPercent) < 0 ? 'negative' : ''}" role="cell" title="Observed 24-hour price change when available">${change}</span>
      <div class="scanner-airdrop-cell" role="cell">${exploreAirdropMarkup(item)}</div>
      <div class="scanner-stage" role="cell"><strong>${stage}</strong><small>${item.complete === false && item.curveProgressPercent != null && Number.isFinite(Number(item.curveProgressPercent)) ? `${Number(item.curveProgressPercent).toFixed(0)}% curve` : ''}</small></div>
      <div class="scanner-boost" role="cell">${activeBoostMultiplier(verifiedBoosts[item.address]) ? `<span class="scanner-boost-total">⚡ ${activeBoostMultiplier(verifiedBoosts[item.address]).toLocaleString()}x active</span>` : ''}<button type="button" class="explore-boost-button" data-boost-mint="${mint}" aria-label="Boost options for ${escapeHtml(item.name)}">${icon('boost')}<span>Boost</span></button></div>
    </div>`;
  }).join('');
  loadVerifiedTokenLogos(list);
  renderWatchlist();
}
