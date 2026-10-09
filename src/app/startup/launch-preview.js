// Startup runs in the order declared in start.js.
export function initializeLaunchPreview(appState) {
  // app-source: 612
  setInterval(()=>{
    appState.refreshQuoteClocks();
    appState.renderPendingLaunchReview();
    if(!appState.launchCostReview)return;
    const launchPageActive=appState.requestedPageRoute()==='launch';
    if(launchPageActive&&!document.hidden&&!appState.walletMetricsLoading&&appState.launchReviewNeedsRefresh(appState.launchCostReview)){
      appState.scheduleLaunchCostRefresh();
    }
  },1000);
  // app-source-end

}
