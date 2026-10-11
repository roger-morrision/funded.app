import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeExploreRegistry(appState) {
  // app-source: 531
  document.querySelector('#payment-list').innerHTML = '<p class="empty-state">Checking finalized payout receipts…</p>';
  // app-source-end

  // app-source: 532
  // app-source-end

  // app-source: 533
  appState.loadReceiptEvidence();
  // app-source-end

  // app-source: 534
  appState.createRoutePoller({ run: signal => appState.loadReceiptEvidence(signal), active: () => appState.coinRouteRequested() || ['overview', 'explore', 'payments', 'analytics-detail', 'buybacks'].includes(appState.requestedPageRoute()), intervalMs: 60_000 });
  // app-source-end

  // app-source: 535
  appState.renderWatchlist();
  // app-source-end

  // app-source: 536
  let registryLaunches = [];
  initializeAppState(appState, 'registryLaunches', registryLaunches);
  // app-source-end

  // app-source: 537
  let registryPage = 1;
  initializeAppState(appState, 'registryPage', registryPage);
  // app-source-end

  // app-source: 538
  let registryCriteriaKey = '';
  initializeAppState(appState, 'registryCriteriaKey', registryCriteriaKey);
  // app-source-end

  // app-source: 542
  appState.renderRegistry();
  // app-source-end

  // app-source: 543
  const toast = document.querySelector('#toast');
  initializeAppState(appState, 'toast', toast);
  // app-source-end

  // app-source: 544
  let toastTimer;
  initializeAppState(appState, 'toastTimer', toastTimer);
  // app-source-end

}
