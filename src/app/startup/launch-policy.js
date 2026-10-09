import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeLaunchPolicy(appState) {
  // app-source: 220
  window.addEventListener('funded:token-page-ready', appState.renderFundedTokenLanding);
  // app-source-end

  // app-source: 221
  let launchTierPriceRequest = 0;
  initializeAppState(appState, 'launchTierPriceRequest', launchTierPriceRequest);
  // app-source-end

}
