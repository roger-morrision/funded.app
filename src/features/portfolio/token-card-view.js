import { withMarketWindow } from '../../../market-intelligence.js';
import { formatCompactUsd, escapeHtml, shortAddress } from '../shared/display.js';
import { icon } from '../../../ui-icons.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function portfolioTokenCardMarkup(
  { mint, name, symbol, removable },
  {
    assets,
    EXPLORE_CLUSTER,
  },
  {
    exploreStageLabel,
    formatCoinUsd,
    launchCardVolumeUsd,
    portfolioHolderCount,
    exploreBoostAmountMarkup,
    tokenCardWatchMarkup,
    tokenCardShareMarkup,
    document = globalThis.document,
  } = {}
) {
  const market = assets.find(item => item.address === mint);
  const item = market && EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(market, '24h') : market;
  const tokenName = item?.name || name || 'Unnamed token';
  const tokenSymbol = item?.symbol || symbol || 'TOKEN';
  const stage = item ? exploreStageLabel(item) : 'Verified launch';
  const cap = item ? (EXPLORE_CLUSTER === 'devnet'
    ? formatCoinUsd(item.migrated === true ? item.poolMarketCapSol : item.curveCapSol)
    : item.marketCapUsd != null ? formatCompactUsd(item.marketCapUsd) : '—') : '—';
  const volume = item ? launchCardVolumeUsd(item, '24h') : '$—';
  const holders = portfolioHolderCount(item);
  const change = item?.change || '—';
  const changeValue = Number.parseFloat(change);
  const changeClass = Number.isFinite(changeValue) ? (changeValue >= 0 ? 'is-positive' : 'is-negative') : '';
  const safeMint = escapeHtml(mint);
  const metrics = [
    [item?.migrated === true || EXPLORE_CLUSTER !== 'devnet' ? 'Market cap' : 'Curve cap', cap],
    ['24h volume', volume], ['Holders', holders], ['24h change', change, changeClass],
  ];
  return `<article class="token-card-shell saved-token-row${removable ? ' watchlist-token-card' : ''}" data-mint="${safeMint}" data-logo-mint="${safeMint}">
    <div class="saved-token-main"><span class="portfolio-token-avatar" aria-hidden="true">${escapeHtml(item?.icon || tokenSymbol.slice(0, 1))}</span><div class="saved-token-identity"><a href="/token/${encodeURIComponent(mint)}"><strong>${escapeHtml(tokenSymbol)} ${exploreBoostAmountMarkup(mint)}</strong><span>${escapeHtml(tokenName)}</span></a><div class="saved-token-address"><code title="${safeMint}">${escapeHtml(shortAddress(mint))}</code><button type="button" class="token-card-copy-address" data-copy-address="${safeMint}" data-copy-kind="token" aria-label="Copy full token address" title="Copy full token address">${icon('copy')}</button></div></div></div>
    <span class="portfolio-token-stage">${escapeHtml(stage)}</span>
    <div class="saved-token-metrics">${metrics.map(([label, value, className = '']) => `<span class="${className}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join('')}</div>
    <div class="saved-token-actions"><a href="/token/${encodeURIComponent(mint)}" class="saved-token-view" aria-label="View token">View</a>${tokenCardWatchMarkup(mint, tokenSymbol)}${tokenCardShareMarkup(mint, tokenSymbol, tokenName)}<button type="button" class="token-card-action-boost" data-boost-mint="${safeMint}" aria-label="Boost ${escapeHtml(tokenSymbol)}">${icon('boost')}<span>Boost</span></button>${market ? `<button type="button" class="token-card-action-trade" data-trade-mint="${safeMint}">Trade</button>` : ''}</div>
  </article>`;
}
