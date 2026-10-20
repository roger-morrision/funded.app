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
  if (scope) scope.textContent = !ready ? loading ? 'Checking launch stages…' : 'Launch stages unavailable.' : exploreProviderStatus.includes('stale') ? 'Launch stages use the last verified feed.' : pending ? `${pending} launch stages await curve or pool verification.` : 'Stages confirmed on-chain.';
  for (const button of document.querySelectorAll('[data-explore-lane]')) {
    const lane = button.dataset.exploreLane;
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
    getFollowingCoverage,
    getFollowingTokenSources,
    document = globalThis.document,
  } = {}
) {
  if (exploreTab === 'favorites') {
    const saved = getWatchlist();
    if (!saved.length) return ['No favorite tokens yet.', 'Select the star on a token to save it here.'];
    if (!assets.some(item => saved.includes(item.address))) return ['Saved tokens are unavailable in this feed.', 'Your favorites remain saved. Try again when the verified launch feed is available.'];
    return ['No favorite tokens match this view.', 'Clear the search or filters to see your saved tokens.'];
  }
  if (exploreTab === 'following') {
    const coverage = getFollowingCoverage();
    if (!coverage.total) return ['No followed wallets yet.', 'Open a trader wallet from a token page and choose Follow wallet.'];
    if (coverage.refreshing && !getFollowingTokenSources().size) return ['Checking followed wallets…', 'Looking for held tokens and observed recent trades.'];
    if (coverage.unavailable || coverage.partial || coverage.checked < coverage.total)
      return ['No matching followed-wallet tokens found.', 'Balance checks are incomplete. Recent trades cover only the indexed sample; try again later.'];
    if (!getFollowingTokenSources().size) return ['No tokens found for followed wallets.', 'No current holdings or recent trades were found among listed tokens.'];
    return ['No followed-wallet tokens match this view.', 'Clear the search or filters to see tokens held or traded by followed wallets.'];
  }
  if ((exploreMinVolumeUsd != null || exploreMinMarketCapUsd != null) && !(Number.isFinite(coinSolUsdPrice) && coinSolUsdPrice > 0)) return ['USD filters are waiting for a conversion quote.', 'SOL/USD is unavailable. Clear the USD minimums to browse verified tokens.'];
  if (exploreRisk === 'watchlist' && !getWatchlist?.().length) return ['No favorite tokens in this feed.', 'Use the star on a verified token to save it here.'];
  if (!assets?.length) return null;
  const tierLabels = { promoted: 'Paid promotion', standard: 'Standard', boost: 'Boost', pro: 'Pro', premier: 'Premier' };
  const rewardLabels = { 'community-airdrop': 'Community token airdrop', 'holder-fees': 'Holder rewards', 'x-fees': 'X account rewards', 'creator-wallet': 'Creator wallet fees' };
  const stageLabels = { curve: 'On curve', near: 'Near', graduated: 'Curve complete', migrated: 'Migrated' };
  const signalLabels = { normal: 'Clear signal', watch: 'Review data', high: 'High risk', watchlist: 'Favorites' };
  const authorityLabels = { 'both-revoked': 'Creating and freezing disabled', 'mint-active': 'More tokens can be created', 'freeze-active': 'Transfers can be frozen' };
  const criteria = [];
  if (explorePromotion && explorePromotion !== 'all') criteria.push(tierLabels[explorePromotion] || `Tier: ${explorePromotion}`);
  if (exploreReward && exploreReward !== 'all') criteria.push(rewardLabels[exploreReward] || `Rewards: ${exploreReward}`);
  if (exploreStage && exploreStage !== 'all') criteria.push(stageLabels[exploreStage] || `Stage: ${exploreStage}`);
  if (exploreRisk && exploreRisk !== 'all') criteria.push(signalLabels[exploreRisk] || `Signal: ${exploreRisk}`);
  if (exploreAuthority && exploreAuthority !== 'all') criteria.push(authorityLabels[exploreAuthority] || `Permissions: ${exploreAuthority}`);
  if (exploreMaxAgeHours != null) criteria.push(`Created within ${exploreMaxAgeHours} hours`);
  if (exploreMinVolumeUsd != null) criteria.push(`Minimum volume: $${exploreMinVolumeUsd}`);
  if (exploreMinMarketCapUsd != null) criteria.push(`Minimum market cap: $${exploreMinMarketCapUsd}`);
  if (exploreMinTrades != null) criteria.push(`Minimum trades: ${exploreMinTrades}`);
  if (exploreMinTraders != null) criteria.push(`Minimum trading wallets: ${exploreMinTraders}`);
  const query = String(exploreQuery || '').trim();
  if (query) criteria.push(`Search: ${query}`);
  if (criteria.length > 1) return [
    'No tokens match this combination.',
    `${query ? 'Search and active filters' : 'Active filters'} apply together. Broaden a selection or clear filters to see more tokens.`,
    criteria.join(' · '),
  ];
  if (query) return ['No token matches your search.', 'Try a token name, symbol, or full token address.'];
  if (explorePromotion && explorePromotion !== 'all') return [
    explorePromotion === 'promoted' ? 'No paid promotions match this view.' : `No ${tierLabels[explorePromotion] || 'selected tier'} tokens match this view.`,
    'Choose another tier or clear filters.',
  ];
  if (exploreReward && exploreReward !== 'all') return ['No token matches this reward type.', 'Choose another reward type or clear filters.'];
  if (exploreMinTraders != null) return ['No launch meets the trading-wallet minimum.', 'Lower the selected-window minimum or clear filters.'];
  if (exploreMinTrades != null || exploreMinVolumeUsd != null) return ['No launch meets these trade-activity minimums.', 'Lower the selected-window minimums or clear filters.'];
  if (exploreMinMarketCapUsd != null || exploreMaxAgeHours != null) return ['No launch meets these advanced filters.', 'Broaden the market cap or age limit, or clear filters.'];
  if (exploreAuthority && exploreAuthority !== 'all') return ['No token matches these permissions.', 'Choose Any permissions or clear filters to see more tokens.'];
  if (exploreRisk === 'watchlist') return ['No favorite tokens in this feed.', 'Use the star on a verified token to save it here.'];
  if (exploreTab === 'new' && exploreNewLane === 'almost') return ['No tokens near migration.', 'This view shows active curves at least 80% filled.'];
  if (exploreTab === 'new' && exploreNewLane === 'migrated') return ['No RPC-verified migrated pools in this feed.', 'A completed curve alone is not migration proof. A PumpSwap pool must also exist on this network.'];
  if (exploreTab === 'new') return ['No launches match this view.', 'Check the stage or age filters, or view all tokens.'];
  if (exploreStage === 'near') return ['No launch is in the final stretch.', 'This lane requires a verified active Pump curve at least 80% filled.'];
  if (exploreStage === 'graduated') return ['No completed curves in this view.', 'Tokens appear here once their launch curve is complete.'];
  return null;
}
