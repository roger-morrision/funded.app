import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeFeeReadiness(appState) {

  // app-source: 261
  let activeAirdropFilter = 'all';
  initializeAppState(appState, 'activeAirdropFilter', activeAirdropFilter);
  // app-source-end

}
