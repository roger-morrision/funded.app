import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeCoinHeader(appState) {
  // app-source: 929
  let coinLabelObserver = null;
  initializeAppState(appState, 'coinLabelObserver', coinLabelObserver);
  // app-source-end

}
