import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeAnalytics(appState) {
  // app-source: 440
  let receiptEvidence = null;
  initializeAppState(appState, 'receiptEvidence', receiptEvidence);
  // app-source-end

  // app-source: 441
  let paymentHistoryEvidence = null;
  initializeAppState(appState, 'paymentHistoryEvidence', paymentHistoryEvidence);
  // app-source-end

  // app-source: 442
  let homeFeeAllocations = null;
  initializeAppState(appState, 'homeFeeAllocations', homeFeeAllocations);
  // app-source-end

  // app-source: 443
  let receiptEvidenceChecked = false;
  initializeAppState(appState, 'receiptEvidenceChecked', receiptEvidenceChecked);
  // app-source-end

  // app-source: 444
  let analyticsSummary = null;
  initializeAppState(appState, 'analyticsSummary', analyticsSummary);
  // app-source-end

  // app-source: 447
  document.addEventListener('click', async event => {
    const copy = event.target.closest('.payment-copy-receiver');
    if (!copy) return;
    try { await navigator.clipboard.writeText(copy.dataset.receiverWallet); appState.showToast('Receiver wallet copied'); }
    catch { appState.showToast('Could not copy receiver wallet'); }
  });
  // app-source-end

  // app-source: 449
  document.addEventListener('funded:analytics-upgraded', () => appState.renderOnchainReportState(appState.assets));
  // app-source-end

  // app-source: 450
  let leaderboardView = 'burners';
  initializeAppState(appState, 'leaderboardView', leaderboardView);
  // app-source-end

  // app-source: 451
  let burnBoardState = { status: 'idle', projects: [] };
  initializeAppState(appState, 'burnBoardState', burnBoardState);
  // app-source-end

  // app-source: 452
  let burnersBoardState = { status: 'idle', wallets: [] };
  initializeAppState(appState, 'burnersBoardState', burnersBoardState);
  // app-source-end

}
