import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeLaunchReview(appState) {
  // app-source: 621
  const LAUNCH_SOCIAL_FIELDS = ['token-website', 'token-x', 'token-telegram', 'token-discord'];
  initializeAppState(appState, 'LAUNCH_SOCIAL_FIELDS', LAUNCH_SOCIAL_FIELDS);
  // app-source-end

  // app-source: 622
  const LAUNCH_SOCIAL_KINDS = { 'token-website': 'website', 'token-x': 'x', 'token-telegram': 'telegram', 'token-discord': 'discord' };
  initializeAppState(appState, 'LAUNCH_SOCIAL_KINDS', LAUNCH_SOCIAL_KINDS);
  // app-source-end

  // app-source: 631
  let pendingLaunchReview = null;
  initializeAppState(appState, 'pendingLaunchReview', pendingLaunchReview);
  // app-source-end

}
