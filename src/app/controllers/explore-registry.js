// Dependencies and mutable application state are read live through appState.
export function createExploreRegistryController(appState) {
  // app-source: 530
  async function loadReceiptEvidence(signal){
    if (appState.receiptEvidenceLoading) return;
    appState.receiptEvidenceLoading = true;
    try {
      const [result, summary, history] = await Promise.all([
        appState.apiRequest('/api/evidence/receipts', { signal }).catch(() => null),
        appState.apiRequest('/api/analytics/summary', { signal }).catch(() => null),
        appState.apiRequest('/api/evidence/payment-history', { signal }).catch(() => null),
      ]);
      signal?.throwIfAborted();
      const data = result?.data;
      appState.receiptEvidence = result?.available === true && data?.cluster === appState.EXPLORE_CLUSTER ? data : null;
      appState.paymentHistoryEvidence = history?.available === true && history.data?.cluster === appState.EXPLORE_CLUSTER ? history.data : null;
      appState.receiptEvidenceChecked = true;
      appState.analyticsSummary = summary?.available === true && summary.data?.homeFeeAllocations?.cluster === appState.EXPLORE_CLUSTER
        ? summary.data : null;
      appState.homeFeeAllocations = summary?.available === true && summary.data?.homeFeeAllocations?.cluster === appState.EXPLORE_CLUSTER
        ? summary.data.homeFeeAllocations : null;
      appState.renderExplorePayoutStats();
      appState.renderOnchainReportState(appState.assets);
      appState.renderHomeKpiDashboard(appState.assets);
    } finally { appState.receiptEvidenceLoading = false; }
  }
  // app-source-end

  // app-source: 539
  function updateExploreSortAvailability(){
    const select = document.querySelector('#explore-sort');
    if (appState.EXPLORE_CLUSTER !== 'devnet') {
      const labels = { 'market-cap': 'Market cap', volume: '24h volume', boosted: 'Active paid boosts', airdrop: 'Community airdrop allocation', 'tier-burn': 'Verified tier burn', 'holder-fee': 'Creator fees to holders', 'x-fee': 'Creator fees to X account', trades: '24h trades', turnover: 'Volume / cap', liquidity: 'Liquidity', 'recent-trade': 'Recent activity', holders: 'Holders', change: '24h price change', newest: 'Newest' };
      if (select) for (const option of select.options) { option.textContent = labels[option.value]; option.disabled = option.value === 'trades'; }
      document.querySelectorAll('[data-explore-sort]').forEach(button => { button.disabled = false; button.title = ''; });
      const headings = document.querySelectorAll('.scanner-head span');
      if (headings[3]) headings[3].textContent = 'Market cap';
      if (headings[4]) headings[4].textContent = '24h volume';
      if (headings[6]) headings[6].textContent = '24h change';
      const note = document.querySelector('#scanner-note');
      if (note) note.textContent = 'Market figures are provider-indexed estimates. A dash means no verified market value is available.';
      return;
    }
    const benefits = appState.assets.map(appState.withVerifiedExploreBenefits);
    const supported = {
      boosted: true,
      'market-cap': appState.assets.some(item => item.curveCapSol != null),
      volume: appState.exploreScannedCount === appState.assets.length && appState.assets.some(item => appState.withMarketWindow(item, appState.exploreWindow).windowVolumeSol != null),
      airdrop: benefits.some(item => item.benefitPolicyVerified && item.communityAirdropPercent != null),
      'tier-burn': benefits.some(item => item.promotionBurnTokens != null),
      'holder-fee': benefits.some(item => item.benefitPolicyVerified && item.holderFeePercent != null),
      'x-fee': benefits.some(item => item.benefitPolicyVerified && item.xFeePercent != null),
      trades: appState.exploreScannedCount === appState.assets.length && appState.assets.some(item => appState.withMarketWindow(item, appState.exploreWindow).windowTradeCount != null),
      turnover: appState.exploreScannedCount === appState.assets.length && appState.assets.some(item => { const metric = appState.withMarketWindow(item, appState.exploreWindow); return metric.windowVolumeSol != null && metric.curveCapSol > 0; }),
      liquidity: appState.assets.some(item => item.curveReserveSol != null),
      'recent-trade': true,
      holders: false,
      change: appState.assets.some(item => item.priceChange24hPercent != null),
      newest: true,
    };
    document.querySelectorAll('[data-explore-sort], [data-explore-leader-sort]').forEach(button => {
      const available = supported[button.dataset.exploreSort || button.dataset.exploreLeaderSort] !== false
        && (!button.dataset.exploreLeaderSort || button.dataset.state === 'ready');
      button.disabled = !available;
      button.title = available ? '' : 'This sort needs more verified data';
    });
    if (select) {
      for (const option of select.options) option.disabled = !supported[option.value];
      if (!supported[appState.exploreSort]) {
        appState.exploreSort = appState.exploreTab === 'new' ? 'newest' : 'recent-trade';
        select.value = appState.exploreSort;
        appState.renderExploreAssets();
      }
    }
  }
  // app-source-end

  // app-source: 540
  function refreshRegistryLaunches(){
    appState.registryLaunches = appState.assets.filter(item => item.address).map(item => appState.withVerifiedExploreBenefits(appState.EXPLORE_CLUSTER === 'devnet' ? appState.withMarketWindow(item, appState.exploreWindow) : appState.enrichMarketRecord(item)));
  }
  // app-source-end

  // app-source: 541
  function renderRegistry(query = appState.exploreQuery) {
    appState.refreshRegistryLaunches();
    return appState.renderRegistryView(query, {
      exploreSort: appState.exploreSort,
      exploreRisk: appState.exploreRisk,
      exploreStage: appState.exploreStage,
      exploreAuthority: appState.exploreAuthority,
      explorePromotion: appState.explorePromotion,
      exploreReward: appState.exploreReward,
      exploreTab: appState.exploreTab,
      exploreNewLane: appState.exploreNewLane,
      exploreWindow: appState.exploreWindow,
      exploreMaxAgeHours: appState.exploreMaxAgeHours,
      exploreMinVolumeUsd: appState.exploreMinVolumeUsd,
      exploreMinMarketCapUsd: appState.exploreMinMarketCapUsd,
      exploreMinTrades: appState.exploreMinTrades,
      exploreMinTraders: appState.exploreMinTraders,
      registryLaunches: appState.registryLaunches,
      exploreProviderStatus: appState.exploreProviderStatus,
      exploreLastVerifiedAt: appState.exploreLastVerifiedAt,
      assets: appState.assets,
      exploreFeedAvailable: appState.exploreFeedAvailable,
      verifiedBoosts: appState.verifiedBoosts,
      EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER,
      get registryPage() { return appState.registryPage; },
      set registryPage(value) { appState.registryPage = value; },
      get registryCriteriaKey() { return appState.registryCriteriaKey; },
      set registryCriteriaKey(value) { appState.registryCriteriaKey = value; },
    }, { getWatchlist: appState.getWatchlist, filterExploreTabRecords: appState.filterExploreTabRecords, exploreOutageCopy: appState.exploreOutageCopy, exploreEmptyReason: appState.exploreEmptyReason, exploreStageLabel: appState.exploreStageLabel, formatOnchainAge: appState.formatOnchainAge, explorePaidListingBagMarkup: appState.explorePaidListingBagMarkup, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, exploreSocialLinksMarkup: appState.exploreSocialLinksMarkup, exploreTierBadgeMarkup: appState.exploreTierBadgeMarkup, exploreMarketCapUsd: appState.exploreMarketCapUsd, formatExploreTradeCount: appState.formatExploreTradeCount, formatExploreUsd: appState.formatExploreUsd, exploreAirdropMarkup: appState.exploreAirdropMarkup, loadVerifiedTokenLogos: appState.loadVerifiedTokenLogos, renderWatchlist: appState.renderWatchlist });
  }
  // app-source-end

  return { loadReceiptEvidence, updateExploreSortAvailability, refreshRegistryLaunches, renderRegistry };
}
