// Startup runs in the order declared in start.js.
export function initializeCoinMarket(appState) {
  // app-source: 952
  void appState.loadSolUsdQuote();
  // app-source-end

}
