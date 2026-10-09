import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeBuyback(appState) {
  // app-source: 342
  let buybackNetworkState = { status:'loading', receipts:[], pending:[] };
  initializeAppState(appState, 'buybackNetworkState', buybackNetworkState);
  // app-source-end

}
