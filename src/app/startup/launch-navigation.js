import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeLaunchNavigation(appState) {
  // app-source: 657
  appState.mountLaunchPage();
  // app-source-end

  // app-source: 660
  let airdropRequestInFlight = false;
  initializeAppState(appState, 'airdropRequestInFlight', airdropRequestInFlight);
  // app-source-end

}
