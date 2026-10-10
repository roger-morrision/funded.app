import { filterMarketRecords } from '../../../market-intelligence.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderExplorePulse(
  records,
  {
    exploreLastVerifiedAt,
    exploreUpdatedAt,
    exploreFeedAvailable,
    exploreProviderStatus,
    exploreTab,
    exploreNewLane,
  },
  {
    document = globalThis.document,
  } = {}
) {
  const ready = Boolean(exploreLastVerifiedAt || (exploreUpdatedAt && exploreFeedAvailable && !/unavailable|rate limited/i.test(exploreProviderStatus)));
  const loading = !exploreUpdatedAt && exploreProviderStatus === 'On-chain only · loading';
  const scope = document.querySelector('#explore-pulse-scope');
  const pending = records.filter(item => item.complete == null).length;
  if (scope) scope.textContent = !ready ? loading ? 'Checking launch stages…' : 'Launch stages unavailable.' : exploreProviderStatus.includes('stale') ? 'Stage counts use the last verified feed.' : pending ? `${pending} launch stages await curve or pool verification.` : 'Stages confirmed on-chain.';
  const lanes = {
    launch: filterMarketRecords(records, { stage: 'launch', sort: 'newest' }),
    almost: filterMarketRecords(records, { stage: 'near', sort: 'newest' }),
    migrated: filterMarketRecords(records, { stage: 'migrated', sort: 'newest' }),
  };
  for (const button of document.querySelectorAll('[data-explore-lane]')) {
    const lane = button.dataset.exploreLane;
    const items = lanes[lane] || [];
    button.querySelector('strong').textContent = ready ? String(items.length).padStart(2, '0') : '—';
    button.querySelector('small').textContent = !ready ? loading ? 'Waiting for verified feed' : 'Verified feed unavailable' : items.length ? items.slice(0, 3).map(item => item.symbol).join(' · ') : lane === 'migrated' ? 'No verified migrated pool' : 'No confirmed launches in this stage';
    const active = exploreTab === 'new' && lane === exploreNewLane;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

export function exploreEmptyReason(
  {
    exploreTab,
    assets,
    exploreMinVolumeUsd,
    exploreMinMarketCapUsd,
    coinSolUsdPrice,
    exploreQuery,
    explorePromotion,
    exploreReward,
    exploreMinTraders,
    exploreMinTrades,
    exploreMaxAgeHours,
    exploreAuthority,
    exploreRisk,
    exploreNewLane,
    exploreStage,
  },
  {
    getWatchlist,
    document = globalThis.document,
  } = {}
) {
  if (exploreTab === 'following') {
    const saved = getWatchlist();
    if (!saved.length) return ['No followed tokens yet.', 'Select the star on a token to save it here.'];
    if (!assets.some(item => saved.includes(item.address))) return ['Saved tokens are unavailable in this feed.', 'Your saved list remains on this device. Try again when the verified launch feed is available.'];
    return ['No followed tokens match this view.', 'Clear the search or filters to see your saved tokens.'];
  }
  if ((exploreMinVolumeUsd != null || exploreMinMarketCapUsd != null) && !(Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0)) return ['USD filters are waiting for a conversion quote.', 'SOL/USD is unavailable. Clear the USD minimums to browse verified tokens.'];
  if (exploreQuery) return ['No token matches your search.', 'Try a token name, symbol, or full token address.'];
  if (explorePromotion !== 'all') return ['No launch matches this promotion filter.', 'Promoted includes verified launch burns and active finalized SOL boost payments.'];
  if (exploreReward !== 'all') return ['No token matches this reward type.', 'Choose another reward type or clear filters.'];
  if (exploreMinTraders != null) return ['No launch meets the trading-wallet minimum.', 'Lower the selected-window minimum or clear filters.'];
  if (exploreMinTrades != null || exploreMinVolumeUsd != null) return ['No launch meets these trade-activity minimums.', 'Lower the selected-window minimums or clear filters.'];
  if (exploreMinMarketCapUsd != null || exploreMaxAgeHours != null) return ['No launch meets these advanced filters.', 'Broaden the market cap or age limit, or clear filters.'];
  if (exploreAuthority !== 'all') return ['No token matches these permissions.', 'Choose Any permissions or clear filters to see more tokens.'];
  if (exploreRisk === 'watchlist') return ['No favorite tokens in this feed.', 'Use the star on a verified token to save it here.'];
  if (exploreTab === 'new' && exploreNewLane === 'almost') return ['No tokens near migration.', 'This view shows active curves at least 80% filled.'];
  if (exploreTab === 'new' && exploreNewLane === 'migrated') return ['No RPC-verified migrated pools in this feed.', 'A completed curve alone is not migration proof. A PumpSwap pool must also exist on this network.'];
  if (exploreTab === 'new') return ['No launches match this view.', 'Check the stage or age filters, or view all tokens.'];
  if (exploreStage === 'near') return ['No launch is in the final stretch.', 'This lane requires a verified active Pump curve at least 80% filled.'];
  if (exploreStage === 'graduated') return ['No completed curves in this view.', 'Tokens appear here once their launch curve is complete.'];
  return null;
}
