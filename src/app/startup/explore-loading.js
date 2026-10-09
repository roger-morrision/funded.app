import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeExploreLoading(appState) {
  // app-source: 525
  const exploreInitialLoadStarted = !appState.coinRouteRequested();
  initializeAppState(appState, 'exploreInitialLoadStarted', exploreInitialLoadStarted);
  // app-source-end

  // app-source: 526
  if (appState.exploreInitialLoadStarted) appState.loadOnchainExploreData().catch(error => {
    console.error('Verified launch feed failed:', error);
    appState.exploreProviderStatus = 'Launch feed unavailable';
    const grid = document.querySelector('#asset-grid');
    if (grid) grid.innerHTML = '<div class="empty-state">Verified launches could not be loaded. Refresh to try again.</div>';
    const status = document.querySelector('#home-live-status');
    const note = document.querySelector('#home-verified-launches-note');
    if (status) status.textContent = 'Solana RPC · unavailable';
    if (note) note.textContent = 'Unable to verify live data';
  });
  // app-source-end

  // app-source: 527
  appState.createRoutePoller({ run: signal => appState.loadOnchainExploreData(signal), active: () => !appState.coinRouteRequested() && ['overview', 'explore', 'community', 'leaderboard', 'payments'].includes(appState.requestedPageRoute()) && appState.exploreAutoRefresh && Date.now() >= appState.exploreBackoffUntil, intervalMs: 30_000 });
  // app-source-end

  // app-source: 528
  appState.createRoutePoller({ run: () => appState.renderStonkEnhancements(), active: () => !appState.coinRouteRequested() && appState.requestedPageRoute() === 'explore' && appState.exploreAutoRefresh, intervalMs: 30_000 });
  // app-source-end

  // app-source: 529
  let receiptEvidenceLoading = false;
  initializeAppState(appState, 'receiptEvidenceLoading', receiptEvidenceLoading);
  // app-source-end

}
