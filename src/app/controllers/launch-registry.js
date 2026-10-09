// Dependencies and mutable application state are read live through appState.
export function createLaunchRegistryController(appState) {
  // app-source: 262
  function getPreviewClaims(){ try { return JSON.parse(localStorage.getItem(appState.AIRDROP_PREVIEW_CLAIM_KEY) || '{}'); } catch { return {}; } }
  // app-source-end

  // app-source: 271
  async function loadCommunityReserveStatuses(){
    const response = await appState.apiRequest('/api/airdrops/reserves').catch(() => ({ available:false }));
    appState.communityReserveStatus = response.available && response.data?.cluster === 'devnet' && Array.isArray(response.data.reserves) ? 'ready' : 'unavailable';
    appState.verifiedCommunityReserves = appState.communityReserveStatus === 'ready'
      ? new Map(response.data.reserves.filter(row => row?.mint).map(row => [row.mint, row])) : new Map();
    appState.communityClaimPolicy = appState.communityReserveStatus === 'ready' ? response.data.claimPolicy || null : null;
    appState.renderHomeKpiDashboard(appState.assets);
    appState.renderAirdropClaims();
    appState.renderRegistry();
  }
  // app-source-end

  // app-source: 272
  function includeVerifiedRegistryLaunches(marketAssets, feedRecords = []) {
    if (appState.EXPLORE_CLUSTER !== 'devnet') return marketAssets;
    const byMint = new Map(marketAssets.filter(item => !item.registryFallback).map(item => [item.address, item]));
    const feedByMint = new Map(feedRecords.map(item => [item.address, item]));
    for (const launch of appState.verifiedLaunchPolicies) {
      if (!launch.mint || byMint.has(launch.mint)) continue;
      const feed = feedByMint.get(launch.mint);
      byMint.set(launch.mint, {
        address: launch.mint, mint: launch.mint,
        name: launch.name || feed?.name || 'Unnamed token',
        symbol: launch.symbol || feed?.symbol || 'TOKEN',
        icon: String(launch.symbol || feed?.symbol || 'T').slice(0, 1),
        imageUri: launch.imageUri || feed?.imageUri || null,
        website: launch.website || feed?.website || null,
        twitter: launch.twitter || feed?.twitter || null,
        telegram: launch.telegram || feed?.telegram || null,
        discord: launch.discord || feed?.discord || null,
        creator: launch.creatorWallet || launch.feePayer || null,
        description: launch.description || feed?.description || '',
        createdTimestamp: Number(launch.createdTimestamp || launch.blockTime || feed?.createdTimestamp) || null,
        source: 'Verified launch registry', registryFallback: true,
        complete: null, migrated: null, change: '—',
        value: 'MC unavailable', meta: 'Verified launch · market data unavailable',
      });
    }
    return [...byMint.values()];
  }
  // app-source-end

  // app-source: 273
  async function loadVerifiedLaunchPolicies(signal){
    const response = await appState.apiRequest('/api/launches', { signal }).catch(() => ({ available: false }));
    signal?.throwIfAborted();
    if (!response.available || !Array.isArray(response.data)) {
      if (appState.verifiedLaunchPoliciesStatus !== 'ready') {
        appState.verifiedLaunchPoliciesStatus = 'unavailable';
        appState.renderHomeHolderRewardCoins();
        appState.renderCreatorLaunches();
        appState.renderAirdropClaims();
      }
      return;
    }
    appState.verifiedLaunchPoliciesStatus = 'ready';
    appState.verifiedLaunchPolicies = response.data.filter(launch => launch.onchainVerified
      && launch.cluster === appState.EXPLORE_CLUSTER
      && (launch.creatorWallet || launch.feePayer));
    appState.assets = appState.includeVerifiedRegistryLaunches(appState.assets);
    appState.updateExploreSortAvailability();
    appState.renderCreatorLaunches();
    appState.renderExploreAssets();
    appState.renderRegistry();
    appState.renderHomeLaunchBoard();
    appState.renderHomeHolderRewardCoins();
    appState.renderHomeKpiDashboard(appState.assets);
    appState.renderLeaderboard();
    appState.renderOnchainReportState(appState.assets);
    appState.renderHomeOnchainSnapshot(appState.assets);
    appState.renderCoinPromotionBadge();
    appState.renderWalletDetail();
    appState.renderAirdropClaims();
    appState.renderBuybackDashboard();
    void appState.loadCommunityReserveStatuses();
  }
  // app-source-end

  // app-source: 274
  function promotionForMint(mint){
    return appState.verifiedPromotionBadge(appState.verifiedLaunchPolicies.find(launch => launch.mint === mint));
  }
  // app-source-end

  // app-source: 281
  function scheduleBoostExpiryRefresh(){
    clearTimeout(appState.boostExpiryTimer);
    const nextExpiry = Math.min(...Object.values(appState.verifiedBoosts).flatMap(item => Array.isArray(item.packages)
      ? item.packages.map(pack => Date.parse(pack.expiresAt)) : [Date.parse(item.nextExpiry || item.expiresAt)])
      .filter(time => Number.isFinite(time) && time > Date.now()));
    if (!Number.isFinite(nextExpiry)) return;
    appState.boostExpiryTimer = setTimeout(() => {
      appState.setCardBoostSnapshot(appState.verifiedBoosts);
      for (const asset of appState.assets) asset.postLaunchBoostMultiplier = appState.activeBoostMultiplier(appState.verifiedBoosts[asset.address]);
      appState.renderExploreAssets();
      appState.renderRegistry();
      appState.renderHomeLaunchBoard();
      appState.renderWatchlist();
      appState.renderCreatorLaunches();
      appState.renderAirdropDirectory();
      appState.renderCoinPromotionBadge();
      appState.scheduleBoostExpiryRefresh();
      if (!document.hidden) void appState.loadVerifiedBoosts();
    }, Math.max(100, nextExpiry - Date.now() + 100));
  }
  // app-source-end

  // app-source: 282
  async function loadVerifiedBoosts(signal){
    const response = await appState.apiRequest('/api/boosts', { signal }).catch(() => ({ available:false }));
    signal?.throwIfAborted();
    if (!response.available || response.data?.cluster !== appState.EXPLORE_CLUSTER) {
      appState.verifiedBoostsAvailable = false;
      appState.verifiedBoosts = {};
      appState.setCardBoostSnapshot(appState.verifiedBoosts);
      clearTimeout(appState.boostExpiryTimer);
      for (const asset of appState.assets) asset.postLaunchBoostMultiplier = 0;
      appState.renderExploreAssets();
      appState.renderRegistry();
      appState.renderHomeLaunchBoard();
      appState.renderWatchlist();
      appState.renderCreatorLaunches();
      appState.renderAirdropDirectory();
      appState.renderCoinPromotionBadge();
      return;
    }
    appState.verifiedBoosts = response.data.active || {};
    appState.verifiedBoostsAvailable = true;
    appState.boostPurchasesEnabled = response.data.enabled === true;
    appState.setCardBoostSnapshot(appState.verifiedBoosts);
    for (const asset of appState.assets) asset.postLaunchBoostMultiplier = appState.activeBoostMultiplier(appState.verifiedBoosts[asset.address]);
    appState.scheduleBoostExpiryRefresh();
    appState.renderExploreAssets();
    appState.renderRegistry();
    appState.renderHomeLaunchBoard();
    appState.renderWatchlist();
    appState.renderCreatorLaunches();
    appState.renderAirdropDirectory();
    appState.renderCoinPromotionBadge();
    if (document.querySelector('#explore-boost-dialog')?.open) appState.renderExploreBoostDialog();
  }
  // app-source-end

  return { getPreviewClaims, loadCommunityReserveStatuses, includeVerifiedRegistryLaunches, loadVerifiedLaunchPolicies, promotionForMint, scheduleBoostExpiryRefresh, loadVerifiedBoosts };
}
