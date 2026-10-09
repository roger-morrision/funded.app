import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeCoinLoading(appState) {
  // app-source: 982
  let coinExitExploreLoad = null;
  initializeAppState(appState, 'coinExitExploreLoad', coinExitExploreLoad);
  // app-source-end

}
