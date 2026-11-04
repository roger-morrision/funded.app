import { initializeAppState } from '../runtime.js';
import { initializeLaunchProtection } from '../../features/coin/launch-protection.js';

// Startup runs in the order declared in start.js.
export function initializeCoinLoading(appState) {
  initializeLaunchProtection(appState);
  // app-source: 982
  let coinExitExploreLoad = null;
  initializeAppState(appState, 'coinExitExploreLoad', coinExitExploreLoad);
  // app-source-end

}
