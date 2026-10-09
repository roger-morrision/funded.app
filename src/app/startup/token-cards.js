import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeTokenCards(appState) {
  // app-source: 301
  window.fundedRenderCoinPromotionBadge = appState.renderCoinPromotionBadge;
  // app-source-end

  // app-source: 314
  window.addEventListener('funded:projects-view-ready', appState.renderCreatorLaunches);
  // app-source-end

  // app-source: 317
  const demoAirdropPrograms = Object.freeze([]);
  initializeAppState(appState, 'demoAirdropPrograms', demoAirdropPrograms);
  // app-source-end

  // app-source: 318
  const indexedClaimers = Object.freeze([]);
  initializeAppState(appState, 'indexedClaimers', indexedClaimers);
  // app-source-end

  // app-source: 319
  // No verified public claimant receipt feed is wired yet.
  const demoUnclaimedWallets = Object.freeze([]);
  initializeAppState(appState, 'demoUnclaimedWallets', demoUnclaimedWallets);
  // app-source-end

  // app-source: 320
  const demoAirdropNotifications = Object.freeze([]);
  initializeAppState(appState, 'demoAirdropNotifications', demoAirdropNotifications);
  // app-source-end

  // app-source: 321
  const demoAirdropHistory = Object.freeze([]);
  initializeAppState(appState, 'demoAirdropHistory', demoAirdropHistory);
  // app-source-end

}
