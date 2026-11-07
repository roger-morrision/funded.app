// Startup runs in the order declared in start.js.
export function initializeCoinMarket(appState, quoteResponse = null) {
  // app-source: 952
  void appState.loadSolUsdQuote(quoteResponse);
  // app-source-end

}
