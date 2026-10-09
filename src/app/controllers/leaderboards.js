// Dependencies and mutable application state are read live through appState.
export function createLeaderboardsController(appState) {
  // app-source: 453
  function launchBurnersFallback(){
    const wallets = new Map();
    const seen = new Set();
    for (const launch of appState.verifiedLaunchPolicies) {
      const burn = launch?.creatorLaunchBurn;
      const receipt = burn?.receipt;
      const wallet = launch?.creatorWallet || launch?.feePayer;
      const amount = Number(receipt?.amountTokens ?? burn?.amountTokens);
      if (!launch?.onchainVerified || burn?.status !== 'verified' || receipt?.verified !== true
        || receipt.instruction !== 'BurnChecked' || receipt.atomicWithPumpLaunch !== true
        || !receipt.signature || seen.has(receipt.signature) || !wallet
        || !Number.isFinite(amount) || amount <= 0) continue;
      seen.add(receipt.signature);
      const row = wallets.get(wallet) || { wallet, burnedTokens:0, receiptCount:0, firstBurnAt:null, latestSignature:null };
      row.burnedTokens += amount;
      row.receiptCount += 1;
      if (!row.firstBurnAt || String(launch.onchainVerifiedAt || '') < row.firstBurnAt) row.firstBurnAt = launch.onchainVerifiedAt || null;
      row.latestSignature = receipt.signature;
      wallets.set(wallet, row);
    }
    return [...wallets.values()].sort((a,b) => b.burnedTokens - a.burnedTokens || a.wallet.localeCompare(b.wallet));
  }
  // app-source-end

  // app-source: 454
  function renderWalletBurnersBoard(){
    return appState.renderWalletBurnersBoardView({ burnersBoardState: appState.burnersBoardState, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus }, { launchBurnersFallback: appState.launchBurnersFallback, formatOnchainAge: appState.formatOnchainAge, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 455
  async function loadWalletBurnBoard(){
    appState.burnersBoardState = { status:'loading', wallets:[] };
    if (appState.leaderboardView === 'burners') appState.renderWalletBurnersBoard();
    const response = await appState.apiRequest('/api/leaderboard/burners').catch(() => ({ available:false }));
    appState.burnersBoardState = response.available && response.data?.cluster === appState.EXPLORE_CLUSTER && Array.isArray(response.data.wallets)
      ? { status:'ready', wallets:response.data.wallets } : { status:'unavailable', wallets:[] };
    if (appState.leaderboardView === 'burners') appState.renderWalletBurnersBoard();
  }
  // app-source-end

  // app-source: 456
  function launchBurnBoardFallback(){
    return appState.verifiedLaunchPolicies.flatMap(launch => {
      const burn = launch?.creatorLaunchBurn;
      const receipt = burn?.receipt;
      const amount = Number(receipt?.amountTokens ?? burn?.amountTokens);
      if (!launch?.onchainVerified || !launch.mint || burn?.status !== 'verified' || receipt?.verified !== true
        || receipt.instruction !== 'BurnChecked' || receipt.atomicWithPumpLaunch !== true
        || !receipt.signature || !Number.isFinite(amount) || amount <= 0) return [];
      return [{ mint: launch.mint, name: launch.name || 'Verified launch', symbol: launch.symbol || 'TOKEN',
        burnedTokens: amount, receiptCount: 1, burnerCount: Number(Boolean(launch.creatorWallet || launch.feePayer)),
        lastBurnAt: launch.onchainVerifiedAt || null, latestSignature: receipt.signature }];
    }).sort((a, b) => b.burnedTokens - a.burnedTokens || a.mint.localeCompare(b.mint));
  }
  // app-source-end

  // app-source: 457
  function renderProjectBurnBoard(){
    return appState.renderProjectBurnBoardView({ burnBoardState: appState.burnBoardState, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus }, { launchBurnBoardFallback: appState.launchBurnBoardFallback, formatOnchainAge: appState.formatOnchainAge, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 458
  async function loadProjectBurnBoard(){
    appState.burnBoardState = { status: 'loading', projects: [] };
    if (appState.leaderboardView === 'burn-board') appState.renderProjectBurnBoard();
    const response = await appState.apiRequest('/api/leaderboard/burn-board').catch(() => ({ available: false }));
    appState.burnBoardState = response.available && response.data?.cluster === appState.EXPLORE_CLUSTER && Array.isArray(response.data.projects)
      ? { status: 'ready', projects: response.data.projects } : { status: 'unavailable', projects: [] };
    if (appState.leaderboardView === 'burn-board') appState.renderProjectBurnBoard();
  }
  // app-source-end

  // app-source: 459
  function selectLeaderboardView(view, focus = false){
    if (!['burners', 'creators', 'burn-board', 'traders'].includes(view)) return;
    appState.leaderboardView = view;
    document.querySelectorAll('[data-leaderboard-view]').forEach(button => {
      const selected = button.dataset.leaderboardView === view;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    appState.renderLeaderboard();
    if (view === 'burn-board') void appState.loadProjectBurnBoard();
    if (view === 'burners' && appState.burnersBoardState.status === 'idle') void appState.loadWalletBurnBoard();
  }
  // app-source-end

  // app-source: 462
  function renderLeaderboard(){
    return appState.renderLeaderboardView({ leaderboardView: appState.leaderboardView, burnersBoardState: appState.burnersBoardState, verifiedLaunchPolicies: appState.verifiedLaunchPolicies, assets: appState.assets, coinSolUsdPrice: appState.coinSolUsdPrice, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, exploreFeedAvailable: appState.exploreFeedAvailable, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { loadWalletBurnBoard: appState.loadWalletBurnBoard, renderWalletBurnersBoard: appState.renderWalletBurnersBoard, renderProjectBurnBoard: appState.renderProjectBurnBoard, formatOnchainAge: appState.formatOnchainAge });
  }
  // app-source-end

  return { launchBurnersFallback, renderWalletBurnersBoard, loadWalletBurnBoard, launchBurnBoardFallback, renderProjectBurnBoard, loadProjectBurnBoard, selectLeaderboardView, renderLeaderboard };
}
