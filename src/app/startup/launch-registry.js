import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeLaunchRegistry(appState) {
  // app-source: 263
  let verifiedLaunchPolicies = [];
  initializeAppState(appState, 'verifiedLaunchPolicies', verifiedLaunchPolicies);
  // app-source-end

  // app-source: 264
  let verifiedLaunchPoliciesStatus = 'loading';
  initializeAppState(appState, 'verifiedLaunchPoliciesStatus', verifiedLaunchPoliciesStatus);
  // app-source-end

  // app-source: 265
  let verifiedCommunityReserves = new Map();
  initializeAppState(appState, 'verifiedCommunityReserves', verifiedCommunityReserves);
  // app-source-end

  // app-source: 266
  let communityReserveStatus = 'loading';
  initializeAppState(appState, 'communityReserveStatus', communityReserveStatus);
  // app-source-end

  // app-source: 267
  let communityClaimPolicy = null;
  initializeAppState(appState, 'communityClaimPolicy', communityClaimPolicy);
  // app-source-end

  // app-source: 268
  let communityFundingPreview = null;
  initializeAppState(appState, 'communityFundingPreview', communityFundingPreview);
  // app-source-end

  // app-source: 269
  let communityClaimReview = null;
  initializeAppState(appState, 'communityClaimReview', communityClaimReview);
  // app-source-end

  // app-source: 270
  const communityWalletAllocations = new Map();
  initializeAppState(appState, 'communityWalletAllocations', communityWalletAllocations);
  // app-source-end

  // app-source: 275
  let verifiedBoosts = {};
  initializeAppState(appState, 'verifiedBoosts', verifiedBoosts);
  // app-source-end

  // app-source: 276
  let verifiedBoostsAvailable = false;
  initializeAppState(appState, 'verifiedBoostsAvailable', verifiedBoostsAvailable);
  // app-source-end

  // app-source: 277
  let boostPurchasesEnabled = false;
  initializeAppState(appState, 'boostPurchasesEnabled', boostPurchasesEnabled);
  // app-source-end

  // app-source: 278
  let boostExpiryTimer = null;
  initializeAppState(appState, 'boostExpiryTimer', boostExpiryTimer);
  // app-source-end

  // app-source: 279
  let boostCheckout = { mint: null, packageId: '10x', quote: null, pendingSignature: null, busy: false, message: '' };
  initializeAppState(appState, 'boostCheckout', boostCheckout);
  // app-source-end

  // app-source: 280
  appState.observeSupplementalBoostCards();
  // app-source-end

}
