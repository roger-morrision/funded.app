// Dependencies and mutable application state are read live through appState.
export function createAnalyticsController(appState) {
  // app-source: 436
  function setHomeDashboardMetric(key, value, note, state = 'available'){
    const card = document.querySelector(`#home-kpi-${key}-card`);
    const valueNode = document.querySelector(`#home-kpi-${key}`);
    const noteNode = document.querySelector(`#home-kpi-${key}-note`);
    if (card) card.dataset.state = state;
    if (valueNode) valueNode.textContent = value;
    if (noteNode) noteNode.textContent = note;
  }
  // app-source-end

  // app-source: 437
  function verifiedLaunchBurns(){
    return appState.verifiedLaunchPolicies
      .map(launch => launch?.creatorLaunchBurn)
      .filter(burn => burn?.status === 'verified' && burn.receipt && Number(burn.receipt.amountTokens ?? burn.amountTokens) > 0);
  }
  // app-source-end

  // app-source: 438
  function renderHomeKpiDashboard(verified = appState.assets){
    return appState.renderHomeKpiDashboardView(verified, { assets: appState.assets, exploreUpdatedAt: appState.exploreUpdatedAt, coinSolUsdPrice: appState.coinSolUsdPrice, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, analyticsSummary: appState.analyticsSummary, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER, receiptEvidence: appState.receiptEvidence, PROTOCOL_FUNDED_MINT: appState.PROTOCOL_FUNDED_MINT }, { verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, setHomeDashboardMetric: appState.setHomeDashboardMetric, homeFeeAllocations: appState.homeFeeAllocations, currentCommunityClaimSummary: appState.currentCommunityClaimSummary, renderFundedTokenLanding: appState.renderFundedTokenLanding });
  }
  // app-source-end

  // app-source: 439
  function renderHomeOnchainSnapshot(verified){
    return appState.renderHomeOnchainSnapshotView(verified, { verifiedLaunchPolicies: appState.verifiedLaunchPolicies, coinSolUsdPrice: appState.coinSolUsdPrice, assets: appState.assets }, { verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, formatExploreTradeCount: appState.formatExploreTradeCount, formatExploreUsd: appState.formatExploreUsd, renderHomeKpiDashboard: appState.renderHomeKpiDashboard });
  }
  // app-source-end

  // app-source: 445
  function renderExtendedAnalyticsDashboard(){
    return appState.renderExtendedAnalyticsDashboardView({ assets: appState.assets, verifiedLaunchPolicies: appState.verifiedLaunchPolicies, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, coinSolUsdPrice: appState.coinSolUsdPrice, receiptEvidence: appState.receiptEvidence, receiptEvidenceChecked: appState.receiptEvidenceChecked, paymentHistoryEvidence: appState.paymentHistoryEvidence }, { verifiedLaunchBurns: appState.verifiedLaunchBurns, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 446
  function renderVerifiedReceiptEvidence(){
    return appState.renderVerifiedReceiptEvidenceView({ receiptEvidence: appState.receiptEvidence, analyticsSummary: appState.analyticsSummary, receiptEvidenceChecked: appState.receiptEvidenceChecked, paymentHistoryEvidence: appState.paymentHistoryEvidence }, { exploreExplorer: appState.exploreExplorer, renderExtendedAnalyticsDashboard: appState.renderExtendedAnalyticsDashboard });
  }
  // app-source-end

  // app-source: 448
  function renderOnchainReportState(verified){
    return appState.renderOnchainReportStateView(verified, { exploreUpdatedAt: appState.exploreUpdatedAt, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, verifiedLaunchPolicies: appState.verifiedLaunchPolicies, exploreProviderStatus: appState.exploreProviderStatus, coinSolUsdPrice: appState.coinSolUsdPrice, analyticsSummary: appState.analyticsSummary }, { verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, renderVerifiedReceiptEvidence: appState.renderVerifiedReceiptEvidence, renderExtendedAnalyticsDashboard: appState.renderExtendedAnalyticsDashboard });
  }
  // app-source-end

  return { setHomeDashboardMetric, verifiedLaunchBurns, renderHomeKpiDashboard, renderHomeOnchainSnapshot, renderExtendedAnalyticsDashboard, renderVerifiedReceiptEvidence, renderOnchainReportState };
}
