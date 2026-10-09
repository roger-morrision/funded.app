// Dependencies and mutable application state are read live through appState.
export function createHomeFeedController(appState) {
  // app-source: 476
  function setHomeLaunchPaused(paused) {
    appState.homeLaunchPaused = paused;
    appState.homeFrozenOrder = null;
    const button = document.querySelector('#home-feed-pause');
    if (!button) return;
    button.classList.toggle('active', paused);
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Resume live reordering' : 'Pause live reordering');
    button.title = paused ? 'Resume live reordering' : 'Pause live reordering';
    button.innerHTML = appState.icon(paused ? 'play' : 'pause');
  }
  // app-source-end

  // app-source: 477
  function syncHomeTickerArrows() {
    const ticker = document.querySelector('#home-market-ticker-items');
    if (!ticker) return;
    const back = document.querySelector('#home-ticker-back');
    const forward = document.querySelector('#home-ticker-forward');
    if (back) back.disabled = appState.homeTickerCycleWidth ? false : ticker.scrollLeft <= 1;
    if (forward) forward.disabled = appState.homeTickerCycleWidth ? false : ticker.scrollLeft + ticker.clientWidth >= ticker.scrollWidth - 1;
  }
  // app-source-end

  // app-source: 478
  function animateHomeTicker(now) {
    const ticker = document.querySelector('#home-market-ticker-items');
    if (ticker && appState.homeTickerCount && !appState.homeTickerCycleWidth && ticker.clientWidth
      && document.body.classList.contains('page-route-overview')) {
      appState.setupHomeTicker(ticker, appState.homeTickerRenderKey, appState.homeTickerCount, true);
    }
    const elapsed = appState.homeTickerLastFrame ? Math.min(now - appState.homeTickerLastFrame, 64) : 0;
    appState.homeTickerLastFrame = now;
    if (ticker && appState.homeTickerCycleWidth && document.body.classList.contains('page-route-overview')
      && document.visibilityState === 'visible' && now >= appState.homeTickerPauseUntil
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && !ticker.matches(':hover, :focus-within')) {
      ticker.scrollLeft += elapsed * 0.036;
      if (ticker.scrollLeft >= appState.homeTickerCycleWidth) ticker.scrollLeft -= appState.homeTickerCycleWidth;
    }
    appState.homeTickerFrame = requestAnimationFrame(appState.animateHomeTicker);
  }
  // app-source-end

  // app-source: 479
  function setupHomeTicker(ticker, markup, count, force = false) {
    if (!force && appState.homeTickerRenderKey === markup) return;
    const previousPosition = appState.homeTickerCycleWidth ? ticker.scrollLeft % appState.homeTickerCycleWidth : 0;
    appState.homeTickerRenderKey = markup;
    appState.homeTickerCount = count;
    ticker.innerHTML = markup;
    appState.homeTickerCycleWidth = 0;
    if (count) {
      const originals = [...ticker.querySelectorAll(':scope > a')];
      const appendCopy = () => {
        const copy = document.createDocumentFragment();
        originals.forEach(link => {
          const clone = link.cloneNode(true);
          clone.setAttribute('aria-hidden', 'true');
          clone.tabIndex = -1;
          copy.append(clone);
        });
        ticker.append(copy);
      };
      appendCopy();
      appState.homeTickerCycleWidth = ticker.children[count].getBoundingClientRect().left - originals[0].getBoundingClientRect().left;
      let copies = 1;
      while (appState.homeTickerCycleWidth && ticker.scrollWidth - ticker.clientWidth < appState.homeTickerCycleWidth + 1 && copies < 20) {
        appendCopy();
        copies++;
      }
      ticker.scrollLeft = appState.homeTickerCycleWidth ? previousPosition % appState.homeTickerCycleWidth : 0;
      if (!appState.homeTickerFrame) appState.homeTickerFrame = requestAnimationFrame(appState.animateHomeTicker);
    } else if (appState.homeTickerFrame) {
      cancelAnimationFrame(appState.homeTickerFrame);
      appState.homeTickerFrame = 0;
      appState.homeTickerLastFrame = 0;
    }
    appState.loadVerifiedTokenLogos(ticker);
    requestAnimationFrame(appState.syncHomeTickerArrows);
  }
  // app-source-end

  // app-source: 484
  async function loadHomeFeeIndex(){
    if (appState.homeFeeIndexLoading || appState.EXPLORE_CLUSTER !== 'devnet') return;
    appState.homeFeeIndexLoading = true;
    try {
      const response = await appState.apiRequest('/api/home/launch-filter-fees', { signal: AbortSignal.timeout(8000) });
      if (!response.available || response.data?.cluster !== appState.EXPLORE_CLUSTER
        || response.data?.coverage !== 'mint-verified-collected-creator-fees-only' || !Array.isArray(response.data.items)) return;
      const amounts = new Map(response.data.items.map(row => [row.mint, String(row.collectedLamports ?? '')]));
      appState.homeFeeAmounts = amounts;
      for (const item of appState.assets) {
        const raw = amounts.get(item.address);
        if (!/^\d+$/.test(raw || '')) continue;
        const lamports = Number(raw);
        if (Number.isSafeInteger(lamports)) item.collectedCreatorFeesSol = lamports / 1_000_000_000;
      }
      appState.renderHomeLaunchBoard();
    } catch { /* Keep the fee filter unavailable when verified ledger data cannot be read. */ }
    finally { appState.homeFeeIndexLoading = false; }
  }
  // app-source-end

  // app-source: 485
  async function loadHomeHolderCounts(records){
    if (appState.homeHolderCountLoading || appState.EXPLORE_CLUSTER !== 'devnet' || !Array.isArray(records) || !records.length) return;
    const candidates = records.slice(0, 12).filter(item => item?.address && (item.holders == null || item.holders === '' || !Number.isFinite(Number(item.holders)) || item.topTenHolderPercent == null));
    if (!candidates.length) return;
    appState.homeHolderCountLoading = true;
    try {
      const { PublicKey } = await appState.getSolana();
      const rpc = await appState.getExploreConnection();
      await Promise.all(candidates.map(async item => {
        const creatorWallet = appState.verifiedLaunchPolicyForMint(item.address)?.creatorWallet || null;
        const cached = appState.homeHolderCountCache.get(item.address);
        if (cached && cached.creatorWallet === creatorWallet && Date.now() - cached.at < 300_000) {
          item.holderWalletCount = cached.count;
          item.holderWalletCoverage = cached.coverage;
          item.holderWalletSampledAccounts = cached.sampledAccounts;
          item.topTenHolderPercent = cached.topTenHolderPercent;
          item.devHoldingPercent = cached.devHoldingPercent;
          return;
        }
        try {
          const result = await appState.fetchTokenAccountSample(item.address, rpc, PublicKey);
          const vault = item.migrated === true ? item.pumpSwapBaseVault : item.curveTokenVault;
          const summary = appState.summarizeHolderWalletSample(result, vault, { mintSupplyRaw: item.mintSupplyRaw, creatorWallet });
          if (!summary) return;
          item.holderWalletCount = summary.count;
          item.holderWalletCoverage = summary.coverage;
          item.holderWalletSampledAccounts = summary.sampledAccounts;
          item.topTenHolderPercent = summary.topTenHolderPercent;
          item.devHoldingPercent = summary.devHoldingPercent;
          appState.homeHolderCountCache.set(item.address, { ...summary, creatorWallet, at: Date.now() });
        } catch { /* Keep holder count unavailable when verified wallet owners cannot be read. */ }
      }));
    } finally {
      appState.homeHolderCountLoading = false;
      appState.renderHomeLaunchBoard();
      if (document.body.classList.contains('page-route-explore')) appState.renderExploreAssets();
    }
  }
  // app-source-end

  // app-source: 486
  function renderHomeHolderRewardCoins(){
    return appState.renderHomeHolderRewardCoinsView({ verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, verifiedLaunchPolicies: appState.verifiedLaunchPolicies }, { verifiedPolicyPercent: appState.verifiedPolicyPercent, loadVerifiedTokenLogos: appState.loadVerifiedTokenLogos });
  }
  // app-source-end

  // app-source: 487
  function homeLaunchFeeRouteMarkup(policy){
    return appState.homeLaunchFeeRouteMarkupView(policy, {  }, { verifiedPolicyPercent: appState.verifiedPolicyPercent, formatVerifiedPercent: appState.formatVerifiedPercent });
  }
  // app-source-end

  // app-source: 488
  function launchCardVolumeUsd(item, window){
    return appState.launchCardVolumeUsdView(item, window, { coinSolUsdPrice: appState.coinSolUsdPrice, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, {  });
  }
  // app-source-end

  // app-source: 489
  function homeLaunchCardMarkup(item, { volumeLabel, volumeValue, extraClass = '', extraActions = '', footerNote = '' }){
    return appState.homeLaunchCardMarkupView(item, { volumeLabel, volumeValue, extraClass, extraActions, footerNote }, { verifiedBoosts: appState.verifiedBoosts, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { exploreStageLabel: appState.exploreStageLabel, formatOnchainAge: appState.formatOnchainAge, formatCoinUsd: appState.formatCoinUsd, verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, homeLaunchFeeRouteMarkup: appState.homeLaunchFeeRouteMarkup, exploreSocialLinksMarkup: appState.exploreSocialLinksMarkup, tokenCardWatchMarkup: appState.tokenCardWatchMarkup, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, tokenCardShareMarkup: appState.tokenCardShareMarkup });
  }
  // app-source-end

  // app-source: 490
  function decorateHomeLaunchCard(card, mint){
    return appState.decorateHomeLaunchCardView(card, mint, {  }, { promotionElement: appState.promotionElement, promotionForMint: appState.promotionForMint, verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint });
  }
  // app-source-end

  // app-source: 491
  function renderHomeLaunchBoard() {
    return appState.renderHomeLaunchBoardView({
      homeLaunchView: appState.homeLaunchView,
      exploreFeedAvailable: appState.exploreFeedAvailable,
      exploreLastVerifiedAt: appState.exploreLastVerifiedAt,
      homeLaunchWindow: appState.homeLaunchWindow,
      assets: appState.assets,
      homeFeeAmounts: appState.homeFeeAmounts,
      coinSolUsdPrice: appState.coinSolUsdPrice,
      homeLaunchSort: appState.homeLaunchSort,
      verifiedBoosts: appState.verifiedBoosts,
      homeLaunchTab: appState.homeLaunchTab,
      homeLaunchFilters: appState.homeLaunchFilters,
      homeLaunchPaused: appState.homeLaunchPaused,
      exploreProviderStatus: appState.exploreProviderStatus,
      EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER,
      get homeFrozenOrder() { return appState.homeFrozenOrder; },
      set homeFrozenOrder(value) { appState.homeFrozenOrder = value; },
    }, { verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, withVerifiedExploreBenefits: appState.withVerifiedExploreBenefits, launchCardVolumeUsd: appState.launchCardVolumeUsd, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, setupHomeTicker: appState.setupHomeTicker, getWatchlist: appState.getWatchlist, promotionForMint: appState.promotionForMint, formatCoinUsd: appState.formatCoinUsd, loadVerifiedTokenLogos: appState.loadVerifiedTokenLogos, homeLaunchCardMarkup: appState.homeLaunchCardMarkup, decorateHomeLaunchCard: appState.decorateHomeLaunchCard });
  }
  // app-source-end

  return { setHomeLaunchPaused, syncHomeTickerArrows, animateHomeTicker, setupHomeTicker, loadHomeFeeIndex, loadHomeHolderCounts, renderHomeHolderRewardCoins, homeLaunchFeeRouteMarkup, launchCardVolumeUsd, homeLaunchCardMarkup, decorateHomeLaunchCard, renderHomeLaunchBoard };
}
