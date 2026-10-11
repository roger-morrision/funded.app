// Dependencies and mutable application state are read live through appState.
export function createLaunchPreviewController(appState) {
  // app-source: 602
  function setLaunchStatus(message, error = false){ const node = document.querySelector('#launch-status'); node.textContent = message; node.className = `launch-status${error ? ' error' : message ? ' success' : ''}`; }
  // app-source-end

  // app-source: 603
  function setLaunchLinks(message, links, error = false){
    const node = document.querySelector('#launch-status');
    node.replaceChildren(document.createTextNode(message));
    for (const link of links) {
      node.append(document.createTextNode('\n'));
      const anchor = document.createElement('a');
      anchor.href = link.href;
      if (!link.href.startsWith('#')) { anchor.target = '_blank'; anchor.rel = 'noreferrer'; }
      anchor.textContent = link.label;
      node.append(anchor);
    }
    node.className = `launch-status${error ? ' error' : ' success'}`;
  }
  // app-source-end

  // app-source: 604
  function formatSol(lamports){ return `${(Number(lamports) / 1_000_000_000).toFixed(4)} SOL`; }
  // app-source-end

  // app-source: 605
  function formatLaunchCost(lamports){ return `${(Number(lamports) / 1_000_000_000).toFixed(6)} SOL`; }
  // app-source-end

  // app-source: 606
  function formatLaunchBurnAmount(amount){ return Number(amount || 0).toLocaleString(); }
  // app-source-end

  // app-source: 607
  function renderLaunchBurnSelection(){
    return appState.renderLaunchBurnSelectionView({ connectedWalletAddress: appState.connectedWalletAddress, fundedBurnState: appState.fundedBurnState, LAUNCH_BURN_TIERS: appState.LAUNCH_BURN_TIERS, launchTierPricing: appState.launchTierPricing, launchTierQuote: appState.launchTierQuote, launchBurnReadiness: appState.launchBurnReadiness, PROTOCOL_FUNDED_MINT: appState.PROTOCOL_FUNDED_MINT }, { getLaunchBurnPolicy: appState.getLaunchBurnPolicy, currentLaunchTierAmounts: appState.currentLaunchTierAmounts, currentLaunchTierQuote: appState.currentLaunchTierQuote, formatLaunchBurnAmount: appState.formatLaunchBurnAmount });
  }
  // app-source-end

  // app-source: 608
  function setLaunchBurnTier(tierId){
    appState.launchBurnTier = appState.SELECTABLE_LAUNCH_TIERS.has(tierId) ? tierId : 'standard';
    appState.launchTierQuote = null;
    const policy = appState.getLaunchBurnPolicy();
    appState.launchBurnReadiness = policy.requiresBurn
      ? { ready: false, message: !appState.PROTOCOL_FUNDED_MINT ? 'The fixed $FUNDED mint is not configured.'
        : !policy.amountTokens ? 'The verified $FUNDED price is unavailable. Refresh the quote.'
          : appState.wallet ? 'Checking the connected wallet’s $FUNDED balance…' : 'Connect a wallet to verify its $FUNDED balance.' }
      : { ready: true, message: 'No creator-funded burn is required.' };
    appState.estimatedLaunchFeeLamports = null;
    appState.renderLaunchBurnSelection();
    appState.updateLaunchPreview();
    if (appState.wallet) appState.scheduleLaunchCostRefresh();
    else { appState.updateCostSummary(); appState.updateLaunchButton(); }
  }
  // app-source-end

  // app-source: 609
  function updateCostSummary(){
    return appState.updateCostSummaryView({ wallet: appState.wallet, estimatedLaunchFeeLamports: appState.estimatedLaunchFeeLamports, walletMetricsLoading: appState.walletMetricsLoading, walletEstimateError: appState.walletEstimateError, launchCostReview: appState.launchCostReview, launchEstimateRetry: appState.launchEstimateRetry }, { renderLaunchCostDetails: appState.renderLaunchCostDetails, getLaunchBurnPolicy: appState.getLaunchBurnPolicy, getCreatorBuySummary: appState.getCreatorBuySummary, getCommunityAirdropTokens: appState.getCommunityAirdropTokens, getCommunityAllocationPercent: appState.getCommunityAllocationPercent, formatLaunchBurnAmount: appState.formatLaunchBurnAmount, creatorBuyExceedsWalletBalance: appState.creatorBuyExceedsWalletBalance, developerBuyLimitReached: appState.developerBuyLimitReached, formatLaunchCost: appState.formatLaunchCost });
  }
  // app-source-end

  // app-source: 610
  function renderLaunchCostDetails(){
    return appState.renderLaunchCostDetailsView({ launchCostReview: appState.launchCostReview, wallet: appState.wallet, walletMetricsLoading: appState.walletMetricsLoading, launchEstimateRetry: appState.launchEstimateRetry }, {  });
  }
  // app-source-end

  // app-source: 611
  function refreshQuoteClocks(){
    if (document.hidden) return;
    appState.updateQuoteCountdowns();
    if (document.querySelector('#explore-boost-dialog')?.open && !appState.boostCheckout.busy && !appState.boostCheckout.pendingSignature
      && appState.boostCheckout.quote && Date.parse(appState.boostCheckout.quote.expiresAt) <= Date.now()
      && document.querySelector('.explore-boost-quote')) {
      appState.boostCheckout.message = 'This price expired. Refresh it and review the new amount before paying.';
      appState.renderExploreBoostDialog();
    }
    if (document.querySelector('#trade-review-dialog')?.open && !appState.currentTradePreview()) {
      const confirm = document.querySelector('#trade-review-confirm');
      if (confirm) confirm.textContent = 'Refresh quote';
    }
    if (appState.fundedBuyPreview && !appState.fundedBuyBusy && Date.now() - appState.fundedBuyPreview.preparedAt >= 15_000) {
      const button = document.querySelector('#funded-buy-submit');
      if (button) button.textContent = 'Refresh quote';
    }
  }
  // app-source-end

  // app-source: 613
  function updatePreviewStatusDrawer(connected){
    const drawer = document.querySelector('.preview-status-drawer');
    const detail = drawer?.querySelector('small');
    if (detail) detail.textContent = `Indexer pending · Wallet ${connected ? 'connected' : 'not connected'}`;
  }
  // app-source-end

  // app-source: 614
  function renderWalletBalance({ loading = false } = {}){
    const balance = appState.walletBalanceLamports;
    const display = loading && balance == null ? 'Loading…' : balance == null ? 'Unavailable' : appState.formatSol(balance);
    document.querySelector('#profile-balance').textContent = appState.wallet ? display : 'Connect to load';
    const compactBalance = loading && balance == null ? '…' : balance == null ? '—' : appState.formatSol(balance).replace(/\s*SOL$/i, '');
    const headerBalance = document.querySelector('#header-wallet-balance');
    const headerWallet = document.querySelector('#connect-button');
    if (headerBalance) headerBalance.textContent = compactBalance;
    if (headerWallet?.classList.contains('wallet-pill-connected')) {
      headerWallet.setAttribute('aria-label', `Wallet ${appState.connectedWalletAddress.slice(0, 4)}…${appState.connectedWalletAddress.slice(-4)}, ${balance == null ? 'SOL balance unavailable' : `${compactBalance} SOL`}`);
      headerWallet.title = balance == null && !loading ? 'SOL balance unavailable. Open the wallet menu to retry.' : '';
    }
    const popoverBalance = document.querySelector('#wallet-popover-sol');
    if (popoverBalance) popoverBalance.textContent = compactBalance;
    appState.renderWalletDetail();
    appState.updateLaunchButton();
    appState.updateCostSummary();
  }
  // app-source-end

  // app-source: 615
  async function refreshWalletBalance({ force = false } = {}){
    const session = appState.captureWalletSession();
    if (!session || (!force && Date.now() - appState.walletBalanceFetchedAt < 15_000)) return;
    const request = ++appState.walletBalanceRequest;
    appState.renderWalletBalance({ loading: true });
    try {
      await appState.getSolana();
      const balance = await appState.withRpcRetry(() => appState.connection.getBalance(session.provider.publicKey, 'confirmed'), { attempts: 2, delaysMs: [700] });
      if (request !== appState.walletBalanceRequest || !appState.isWalletSessionCurrent(session)) return;
      appState.walletBalanceLamports = balance;
      appState.walletBalanceFetchedAt = Date.now();
    } catch (error) {
      if (request !== appState.walletBalanceRequest || !appState.isWalletSessionCurrent(session)) return;
      appState.walletBalanceLamports = null;
      appState.walletBalanceFetchedAt = 0;
      console.warn('SOL balance refresh failed:', error);
    }
    appState.renderWalletBalance();
  }
  // app-source-end

  // app-source: 616
  function setWalletMetrics({ balance, fee = null, loading = false, error = '' } = {}){
    appState.walletMetricsLoading = loading;
    appState.walletEstimateError = loading || !appState.wallet ? '' : String(error || '');
    if (loading || !appState.wallet || fee == null) { appState.estimatedLaunchFeeLamports = null; appState.estimatedInitialBuyLamports = 0; appState.estimatedInitialBuyTokens = 0; appState.launchCostReview = null; }
    if (!appState.wallet) { appState.walletBalanceLamports = null; appState.estimatedLaunchFeeLamports = null; appState.renderWalletBalance(); return; }
    if (!loading) {
      if (balance !== undefined) {
        appState.walletBalanceLamports = balance;
        if (balance != null) appState.walletBalanceFetchedAt = Date.now();
      }
      appState.estimatedLaunchFeeLamports = fee;
    }
    appState.renderWalletBalance({ loading });
  }
  // app-source-end

  // app-source: 617
  function updateLaunchPreview(){
    return appState.updateLaunchPreviewView({ wallet: appState.wallet, feeRouterState: appState.feeRouterState, xFeeStatus: appState.xFeeStatus, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { getCommunityAllocationPercent: appState.getCommunityAllocationPercent, getCommunityAirdropTokens: appState.getCommunityAirdropTokens, getFeeDistributionInputs: appState.getFeeDistributionInputs, getLaunchBurnPolicy: appState.getLaunchBurnPolicy, getBannerPreviewUrl: appState.getBannerPreviewUrl, getCreatorBuySummary: appState.getCreatorBuySummary, creatorBuyExceedsWalletBalance: appState.creatorBuyExceedsWalletBalance, formatVerifiedPercent: appState.formatVerifiedPercent, formatLaunchBurnAmount: appState.formatLaunchBurnAmount, xFeeFailureDetail: appState.xFeeFailureDetail, renderLaunchBurnSelection: appState.renderLaunchBurnSelection, updateLaunchNavigation: appState.updateLaunchNavigation });
  }
  // app-source-end

  // app-source: 618
  function getLaunchMetadataPreview(){
    return appState.getLaunchMetadataPreviewView({  }, {  });
  }
  // app-source-end

  return { setLaunchStatus, setLaunchLinks, formatSol, formatLaunchCost, formatLaunchBurnAmount, renderLaunchBurnSelection, setLaunchBurnTier, updateCostSummary, renderLaunchCostDetails, refreshQuoteClocks, updatePreviewStatusDrawer, renderWalletBalance, refreshWalletBalance, setWalletMetrics, updateLaunchPreview, getLaunchMetadataPreview };
}
