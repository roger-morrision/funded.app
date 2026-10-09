import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeBoostCheckout(appState) {
  // app-source: 290
  let exploreBoostHistory = [];
  initializeAppState(appState, 'exploreBoostHistory', exploreBoostHistory);
  // app-source-end

  // app-source: 291
  let exploreBoostHistoryState = 'loading';
  initializeAppState(appState, 'exploreBoostHistoryState', exploreBoostHistoryState);
  // app-source-end

}
