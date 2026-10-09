import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeBuybackPreview(appState) {
  // app-source: 358
  let assets = [];
  initializeAppState(appState, 'assets', assets);
  // app-source-end

  // app-source: 359
  window.fundedVerifiedSearchCandidates = (query = '') => {
    const term = String(query).trim().toLowerCase();
    const capUsd = item => {
      const raw = appState.EXPLORE_CLUSTER === 'devnet'
        ? Number(item.migrated === true ? item.poolMarketCapSol : item.curveCapSol) * appState.coinSolUsdPrice
        : Number(item.marketCapUsd);
      return Number.isFinite(raw) && raw >= 0 ? raw : -1;
    };
    return appState.assets.filter(item => item.address && (!term || [item.name, item.symbol, item.address].some(value => String(value || '').toLowerCase().includes(term))))
      .sort((a, b) => {
        const rank = item => !term ? 0 : String(item.symbol || '').toLowerCase() === term ? 3 : String(item.symbol || '').toLowerCase().startsWith(term) ? 2 : String(item.name || '').toLowerCase().startsWith(term) ? 1 : 0;
        return rank(b) - rank(a) || capUsd(b) - capUsd(a) || String(a.name || '').localeCompare(String(b.name || ''));
      })
      .slice(0, term ? 8 : 5)
      .map(item => ({ name: item.name || item.symbol || 'Token', symbol: item.symbol || 'TOKEN', mint: item.address, stage: appState.exploreStageLabel(item), marketCap: appState.exploreMarketCapUsd(item) }));
  };
  // app-source-end

  // app-source: 360
  let coinSolUsdPrice = null;
  initializeAppState(appState, 'coinSolUsdPrice', coinSolUsdPrice);
  // app-source-end

  // app-source: 361
  let exploreQuery = '';
  initializeAppState(appState, 'exploreQuery', exploreQuery);
  // app-source-end

  // app-source: 362
  let exploreSort = 'volume';
  initializeAppState(appState, 'exploreSort', exploreSort);
  // app-source-end

  // app-source: 363
  let exploreRisk = 'all';
  initializeAppState(appState, 'exploreRisk', exploreRisk);
  // app-source-end

  // app-source: 364
  let exploreStage = 'all';
  initializeAppState(appState, 'exploreStage', exploreStage);
  // app-source-end

  // app-source: 365
  let exploreAuthority = 'all';
  initializeAppState(appState, 'exploreAuthority', exploreAuthority);
  // app-source-end

  // app-source: 366
  let explorePromotion = 'all';
  initializeAppState(appState, 'explorePromotion', explorePromotion);
  // app-source-end

  // app-source: 367
  let exploreReward = 'all';
  initializeAppState(appState, 'exploreReward', exploreReward);
  // app-source-end

  // app-source: 368
  let exploreWindow = '24h';
  initializeAppState(appState, 'exploreWindow', exploreWindow);
  // app-source-end

  // app-source: 369
  let exploreTab = 'trending';
  initializeAppState(appState, 'exploreTab', exploreTab);
  // app-source-end

  // app-source: 370
  let exploreNewLane = 'all';
  initializeAppState(appState, 'exploreNewLane', exploreNewLane);
  // app-source-end

  // app-source: 371
  const EXPLORE_VIEW_KEY = 'funded.explore-view';
  initializeAppState(appState, 'EXPLORE_VIEW_KEY', EXPLORE_VIEW_KEY);
  // app-source-end

  // app-source: 372
  let exploreView = (() => { try { return localStorage.getItem(appState.EXPLORE_VIEW_KEY) === 'table' ? 'table' : 'grid'; } catch { return 'grid'; } })();
  initializeAppState(appState, 'exploreView', exploreView);
  // app-source-end

  // app-source: 373
  let exploreMaxAgeHours = null;
  initializeAppState(appState, 'exploreMaxAgeHours', exploreMaxAgeHours);
  // app-source-end

  // app-source: 374
  let exploreMinVolumeUsd = null;
  initializeAppState(appState, 'exploreMinVolumeUsd', exploreMinVolumeUsd);
  // app-source-end

  // app-source: 375
  let exploreMinMarketCapUsd = null;
  initializeAppState(appState, 'exploreMinMarketCapUsd', exploreMinMarketCapUsd);
  // app-source-end

  // app-source: 376
  let exploreMinTrades = null;
  initializeAppState(appState, 'exploreMinTrades', exploreMinTrades);
  // app-source-end

  // app-source: 377
  let exploreMinTraders = null;
  initializeAppState(appState, 'exploreMinTraders', exploreMinTraders);
  // app-source-end

  // app-source: 378
  let exploreAutoRefresh = true;
  initializeAppState(appState, 'exploreAutoRefresh', exploreAutoRefresh);
  // app-source-end

  // app-source: 379
  let exploreBackoffUntil = 0;
  initializeAppState(appState, 'exploreBackoffUntil', exploreBackoffUntil);
  // app-source-end

  // app-source: 380
  let exploreFeedSort = null;
  initializeAppState(appState, 'exploreFeedSort', exploreFeedSort);
  // app-source-end

  // app-source: 381
  let exploreUpdatedAt = null;
  initializeAppState(appState, 'exploreUpdatedAt', exploreUpdatedAt);
  // app-source-end

  // app-source: 382
  let exploreLastVerifiedAt = null;
  initializeAppState(appState, 'exploreLastVerifiedAt', exploreLastVerifiedAt);
  // app-source-end

  // app-source: 383
  let exploreFeedAvailable = false;
  initializeAppState(appState, 'exploreFeedAvailable', exploreFeedAvailable);
  // app-source-end

  // app-source: 384
  let exploreProviderStatus = 'On-chain only · loading';
  initializeAppState(appState, 'exploreProviderStatus', exploreProviderStatus);
  // app-source-end

  // app-source: 385
  const exploreActivityCache = new Map();
  initializeAppState(appState, 'exploreActivityCache', exploreActivityCache);
  // app-source-end

  // app-source: 386
  let exploreScannedCount = 0;
  initializeAppState(appState, 'exploreScannedCount', exploreScannedCount);
  // app-source-end

  // app-source: 387
  const watchlistSync = appState.createWatchlistSync({
    request: appState.apiRequest,
    storage: localStorage,
    onChange(mints) {
      appState.lastKnownWatchlist = mints;
      appState.renderWatchlist();
      if (appState.homeLaunchTab === 'watchlist') appState.renderHomeLaunchBoard();
      if (appState.exploreRisk === 'watchlist') appState.updateExploreViews();
      window.dispatchEvent(new Event('funded:watchlist-changed'));
    },
    onStatus(state, message) {
      appState.watchlistUnavailable = state === 'error';
      const badge = document.querySelector('#community .section-state');
      if (badge) badge.textContent = { synced: 'Synced to account', syncing: 'Syncing', checking: 'Checking sign-in', guest: 'Sign in to sync', error: 'Sync unavailable' }[state];
      const signIn = document.querySelector('#watchlist-sign-in');
      if (signIn) signIn.hidden = Boolean(appState.watchlistSync.identity());
      appState.showWatchlistStatus(message);
      appState.renderWatchlist();
    },
  });
  initializeAppState(appState, 'watchlistSync', watchlistSync);
  // app-source-end

  // app-source: 388
  window.addEventListener('focus', () => { if (!document.hidden) void appState.watchlistSync.refresh(); });
  // app-source-end

  // app-source: 389
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void appState.watchlistSync.refresh(); });
  // app-source-end

  // app-source: 390
  setInterval(() => { if (!document.hidden) void appState.watchlistSync.refresh(); }, 60000);
  // app-source-end

  // app-source: 391
  document.querySelector('#watchlist-sign-in')?.addEventListener('click', () => document.querySelector('#x-sign-in')?.click());
  // app-source-end

  // app-source: 392
  document.querySelector('#watchlist-sync-retry')?.addEventListener('click', () => { void appState.loadXIdentity().then(() => appState.watchlistSync.refresh()); });
  // app-source-end

}
