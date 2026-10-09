// Dependencies and mutable application state are read live through appState.
export function createPortfolioController(appState) {
  // app-source: 932
  function getWalletDetailAddress(){
    const match = location.pathname.match(/^\/wallet\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  }
  // app-source-end

  // app-source: 933
  function showWalletPage(open = true){
    const main = document.querySelector('.main-content');
    const page = document.querySelector('#wallet-page');
    const coin = document.querySelector('#coin-page');
    if (!main || !page) return;
    if (!open){ main.classList.remove('wallet-view'); page.hidden = true; return; }
    const address = appState.getWalletDetailAddress();
    main.classList.remove('coin-view'); main.classList.add('wallet-view');
    if (coin) coin.hidden = true;
    page.hidden = false;
    appState.renderWalletDetail();
    if (address && address === appState.connectedWalletAddress) void appState.loadFundedBurnState();
    const explorer = document.querySelector('#wallet-explorer-link');
    if (explorer) { explorer.href = address ? appState.exploreExplorer(`address/${encodeURIComponent(address)}`) : '#'; explorer.hidden = !address; }
    const routeLabel = document.querySelector('#route-context [data-route-label]');
    const routeDescription = document.querySelector('#route-context [data-route-description]');
    if (routeLabel) routeLabel.textContent = 'Wallet';
    if (routeDescription) routeDescription.textContent = 'Balances, launches, and available activity';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // app-source-end

  // app-source: 934
  function walletDetailLaunches(address){
    if (!address) return [];
    return appState.verifiedLaunchPolicies.filter(launch => launch.creatorWallet === address && launch.mint)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }
  // app-source-end

  // app-source: 935
  function walletDetailTrades(address){
    if (!address) return [];
    return appState.collectRecentTrades(appState.assets, { limit: 1000, since: Math.floor(Date.now() / 1000) - 86400 }).filter(trade => trade.trader === address).slice(0, 100);
  }
  // app-source-end

  // app-source: 936
  async function refreshPortfolioHoldings(){
    const address = appState.connectedWalletAddress;
    const request = ++appState.portfolioRequest;
    appState.portfolioHoldings = { wallet: address || '', status: address ? 'loading' : 'idle', accounts: [], coverage: '' };
    appState.renderPortfolio();
    if (!address) return;
    try {
      const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await appState.getSolana();
      const rpc = await appState.getExploreConnection();
      const owner = new PublicKey(address);
      const results = await Promise.allSettled([
        rpc.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
        rpc.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
      ]);
      if (request !== appState.portfolioRequest || address !== appState.connectedWalletAddress) return;
      const success = results.filter(result => result.status === 'fulfilled');
      appState.portfolioHoldings = {
        wallet: address,
        status: success.length ? 'ready' : 'unavailable',
        accounts: appState.aggregateTokenAccounts(success.flatMap(result => result.value?.value || [])),
        coverage: success.length === 2 ? 'SPL Token and Token-2022' : success.length ? 'Partial token-program coverage' : 'RPC unavailable',
      };
    } catch {
      if (request !== appState.portfolioRequest || address !== appState.connectedWalletAddress) return;
      appState.portfolioHoldings = { wallet: address, status: 'unavailable', accounts: [], coverage: 'RPC unavailable' };
    }
    appState.renderPortfolio();
  }
  // app-source-end

  // app-source: 937
  function portfolioUnitPriceUsd(asset){
    const priceSol = asset?.migrated ? Number(asset.poolPriceSol) : Number(asset?.curvePriceSol);
    if (Number.isFinite(priceSol) && priceSol > 0 && Number.isFinite(appState.coinSolUsdPrice) && appState.coinSolUsdPrice > 0) return priceSol * appState.coinSolUsdPrice;
    return null;
  }
  // app-source-end

  // app-source: 938
  function renderPortfolio(){
    return appState.renderPortfolioView({ connectedWalletAddress: appState.connectedWalletAddress, portfolioHoldings: appState.portfolioHoldings, assets: appState.assets, exploreScannedCount: appState.exploreScannedCount }, { portfolioUnitPriceUsd: appState.portfolioUnitPriceUsd, walletDetailTrades: appState.walletDetailTrades, formatOnchainAge: appState.formatOnchainAge, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 939
  function activatePortfolioTab(name, focus = false){
    const tabs = document.querySelectorAll('[data-portfolio-tab]');
    for (const button of tabs) {
      const active = button.dataset.portfolioTab === name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      const panel = document.querySelector(`#portfolio-${button.dataset.portfolioTab}-panel`);
      if (panel) panel.hidden = !active;
      if (active && focus) button.focus();
    }
  }
  // app-source-end

  // app-source: 943
  function walletDetailBurned(launches){
    const values = launches.map(launch => launch.creatorLaunchBurn).filter(burn => burn?.status === 'verified' && burn.receipt);
    return values.reduce((sum, burn) => sum + Number(burn.receipt.amountTokens ?? burn.amountTokens ?? 0), 0);
  }
  // app-source-end

  // app-source: 944
  function walletDetailEmpty(title, detail){
    return `<div class="wallet-detail-empty"><strong>${appState.escapeHtml(title)}</strong><span>${appState.escapeHtml(detail)}</span></div>`;
  }
  // app-source-end

  // app-source: 945
  function loadWalletRowLogos(content, launches){
    for (const row of content.querySelectorAll('.wallet-activity-row[data-token-mint]')) {
      const mint = row.dataset.tokenMint;
      appState.loadPortfolioLogo(row, appState.verifiedLaunchPolicyForMint(mint) || launches.find(launch => launch.mint === mint));
    }
  }
  // app-source-end

  // app-source: 946
  function walletLaunchTimestamp(launch){
    const age = appState.tokenAge(launch.createdTimestamp ?? launch.createdAt);
    return age.timestamp ? Date.parse(age.timestamp) : 0;
  }
  // app-source-end

  // app-source: 947
  function renderWalletDetail(){
    return appState.renderWalletDetailView({ connectedWalletAddress: appState.connectedWalletAddress, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, exploreScannedCount: appState.exploreScannedCount, assets: appState.assets, exploreProviderStatus: appState.exploreProviderStatus, exploreFeedAvailable: appState.exploreFeedAvailable, walletBalanceLamports: appState.walletBalanceLamports, coinSolUsdPrice: appState.coinSolUsdPrice, walletDetailTab: appState.walletDetailTab, walletDetailFilter: appState.walletDetailFilter, fundedBurnState: appState.fundedBurnState }, { getWalletDetailAddress: appState.getWalletDetailAddress, walletDetailLaunches: appState.walletDetailLaunches, walletDetailTrades: appState.walletDetailTrades, walletDetailBurned: appState.walletDetailBurned, walletLaunchTimestamp: appState.walletLaunchTimestamp, validateSolanaMint: appState.validateSolanaMint, getFollowedWallets: appState.getFollowedWallets, formatSol: appState.formatSol, formatOnchainAge: appState.formatOnchainAge, walletDetailEmpty: appState.walletDetailEmpty, loadWalletRowLogos: appState.loadWalletRowLogos, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  return { getWalletDetailAddress, showWalletPage, walletDetailLaunches, walletDetailTrades, refreshPortfolioHoldings, portfolioUnitPriceUsd, renderPortfolio, activatePortfolioTab, walletDetailBurned, walletDetailEmpty, loadWalletRowLogos, walletLaunchTimestamp, renderWalletDetail };
}
