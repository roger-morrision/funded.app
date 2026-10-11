import { shouldAutoRefreshLaunchEstimate } from '../../features/launch/estimate-refresh.js';
// Startup runs in the order declared in start.js.
export function initializeLaunchPreview(appState, { document = globalThis.document, navigator = globalThis.navigator, setInterval = globalThis.setInterval } = {}) {
  // app-source: 612
  setInterval(()=>{
    appState.refreshQuoteClocks();
    appState.renderPendingLaunchReview();
    const launchPageActive=appState.requestedPageRoute()==='launch';
    if (launchPageActive && !document.hidden && appState.wallet && appState.launchEstimateRetry?.retryable) appState.updateCostSummary();
    if (shouldAutoRefreshLaunchEstimate({ active: launchPageActive, visible: !document.hidden, online: navigator.onLine !== false,
      wallet: appState.wallet, loading: appState.walletMetricsLoading, reviewing: appState.pendingLaunchReview,
      submitting: appState.launchSubmitting, review: appState.launchCostReview, error: appState.walletEstimateError,
      // The estimate uses placeholder token identity and does not need an uploaded logo.
      // Keep quote refresh available while the creator is still completing coin details.
      retry: appState.launchEstimateRetry, validForm: launchPageActive && appState.feeRouterState?.verified && appState.getLaunchStepState(2).valid })) {
      appState.scheduleLaunchCostRefresh();
    }
  },1000);
  // app-source-end

}
