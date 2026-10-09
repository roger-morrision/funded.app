// Startup runs in the order declared in start.js.
export function initializeShareConsent(appState) {
  // app-source: 251
  document.addEventListener('funded:share-action', () => appState.renderShareInsights());
  // app-source-end

  // app-source: 254
  appState.initShareVisitConsent();
  // app-source-end

}
