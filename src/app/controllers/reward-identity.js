// Dependencies and mutable application state are read live through appState.
export function createRewardIdentityController(appState) {
  // app-source: 1004
  function renderXClaimSummary(claims) {
    return appState.renderXClaimSummaryFeature(claims, {  });
  }
  // app-source-end

  // app-source: 1005
  async function loadXIdentity() {
    return appState.loadXIdentityFeature({ renderXClaimSummary: appState.renderXClaimSummary, syncXClaimFlow: appState.syncXClaimFlow, refreshXClaims: appState.refreshXClaims, resetSolClaimStatus: appState.resetSolClaimStatus, watchlistSync: appState.watchlistSync, apiRequest: appState.apiRequest });
  }
  // app-source-end

  // app-source: 1006
  async function refreshXClaims() {
    return appState.refreshXClaimsFeature({ renderXClaimSummary: appState.renderXClaimSummary, syncXClaimFlow: appState.syncXClaimFlow, verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, updateClaimBindingReview: appState.updateClaimBindingReview, resetSolClaimStatus: appState.resetSolClaimStatus, apiRequest: appState.apiRequest });
  }
  // app-source-end

  return { renderXClaimSummary, loadXIdentity, refreshXClaims };
}
