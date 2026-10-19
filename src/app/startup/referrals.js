import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeReferrals(appState) {
  // app-source: 246
  appState.initShareComposer();
  document.querySelector('[data-referral-connect]')?.addEventListener('click', () => document.querySelector('#connect-button')?.click());
  // app-source-end

  // app-source: 249
  let lastShareDashboard = null;
  initializeAppState(appState, 'lastShareDashboard', lastShareDashboard);
  // app-source-end

}
