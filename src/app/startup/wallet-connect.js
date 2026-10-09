import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeWalletConnect(appState) {
  // app-source: 655
  let launchOpener=null;
  initializeAppState(appState, 'launchOpener', launchOpener);
  // app-source-end

}
