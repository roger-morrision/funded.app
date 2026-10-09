// Dependencies and mutable application state are read live through appState.
export function createExploreActionsController(appState) {
  // app-source: 766
  function updateExploreViews(force = false){ appState.renderExploreAssets({ force }); appState.renderRegistry(); }
  // app-source-end

  // app-source: 767
  function clearExploreFilters(){
    appState.exploreQuery = '';
    appState.exploreRisk = 'all';
    appState.exploreStage = 'all';
    appState.exploreAuthority = 'all';
    appState.explorePromotion = 'all';
    appState.exploreReward = 'all';
    appState.exploreWindow = '24h';
    appState.exploreTab = 'trending';
    appState.exploreNewLane = 'all';
    appState.exploreMaxAgeHours = null;
    appState.exploreMinVolumeUsd = null;
    appState.exploreMinMarketCapUsd = null;
    appState.exploreMinTrades = null;
    appState.exploreMinTraders = null;
    appState.exploreSort = document.querySelector('#explore-sort option[value="volume"]:not(:disabled)') ? 'volume' : 'recent-trade';
    for (const selector of ['#global-search', '#explore-search', '#explore-min-volume-sol', '#explore-min-cap-sol', '#explore-min-trades', '#explore-min-traders', '#explore-max-age-hours']) {
      const input = document.querySelector(selector);
      if (input) input.value = '';
    }
    document.querySelector('#explore-risk-filter').value = 'all';
    document.querySelector('#explore-authority-filter').value = 'all';
    document.querySelector('#explore-promotion-filter').value = 'all';
    document.querySelector('#explore-reward-filter').value = 'all';
    document.querySelector('#explore-sort').value = appState.exploreSort;
    document.querySelectorAll('[data-explore-stage]').forEach(button => { const active = button.dataset.exploreStage === appState.exploreStage; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => { const active = button.dataset.exploreTab === appState.exploreTab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    appState.updateExploreViews(true);
    document.querySelector('#explore')?.dispatchEvent(new Event('funded:explore-filters-cleared'));
    appState.refreshExploreFeedForSort();
  }
  // app-source-end

  // app-source: 768
  function refreshExploreFeedForSort(){
    const required = appState.exploreSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
    if (appState.exploreFeedSort !== required) appState.loadOnchainExploreData().catch(() => appState.showToast('Launch feed could not refresh.'));
  }
  // app-source-end

  // app-source: 769
  function readOptionalSolFilter(selector, { integer = false } = {}){
    const input = document.querySelector(selector);
    const value = input?.value.trim();
    if (!value) return null;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0 && (!integer || Number.isInteger(number))) return number;
    input.value = '';
    appState.showToast(integer ? 'Enter a whole-number minimum of 0 or more.' : 'Enter a minimum of 0 or more.');
    return null;
  }
  // app-source-end

  // app-source: 770
  function openExploreTrade(mint){
    if (!appState.assets.some(item => item.address === mint)) return;
    try { sessionStorage.setItem('funded.pendingTradeMint', mint); } catch { /* The destination URL already carries the selected mint. */ }
    window.location.assign(`/token/${encodeURIComponent(mint)}`);
  }
  // app-source-end

  // app-source: 788
  function positionExploreFilters(){
    const popover = document.querySelector('#explore-filter-popover');
    const toggle = document.querySelector('#explore-filter-toggle');
    if (!popover || popover.hidden || !toggle) return;
    const viewport = window.visualViewport;
    const margin = 12, gap = 8;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = Math.min(viewport?.width || innerWidth, document.documentElement.clientWidth);
    const viewportBottom = viewportTop + (viewport?.height || innerHeight);
    const header = document.querySelector('.topbar')?.getBoundingClientRect();
    const navigation = document.querySelector('.mobile-workspace-nav')?.getBoundingClientRect();
    const top = Math.max(viewportTop + margin, (header?.bottom || 0) + gap);
    const bottom = Math.min(viewportBottom - margin,
      navigation?.height && navigation.top > top ? navigation.top - gap : viewportBottom - margin);
    const anchor = toggle.getBoundingClientRect();
    const width = Math.min(440, viewportWidth - margin * 2);
    const below = Math.max(0, bottom - anchor.bottom - gap);
    const above = Math.max(0, anchor.top - gap - top);
    const openBelow = below >= Math.min(320, popover.scrollHeight) || below >= above;
    const maxHeight = Math.max(0, Math.min(620, bottom - top, openBelow ? below : above));
    Object.assign(popover.style, {
      position: 'fixed', right: 'auto', bottom: 'auto', width: `${width}px`,
      maxHeight: `${maxHeight}px`,
      left: `${Math.max(viewportLeft + margin, Math.min(anchor.left, viewportLeft + viewportWidth - width - margin))}px`,
    });
    const height = popover.getBoundingClientRect().height;
    popover.style.top = `${Math.max(top, Math.min(openBelow ? anchor.bottom + gap : anchor.top - gap - height, bottom - height))}px`;
  }
  // app-source-end

  // app-source: 789
  function setExploreFilterOpen(open){
    const popover = document.querySelector('#explore-filter-popover');
    const toggle = document.querySelector('#explore-filter-toggle');
    if (!popover || !toggle) return;
    popover.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close launch filters' : 'Open launch filters');
    if (open) appState.positionExploreFilters();
  }
  // app-source-end

  // app-source: 806
  async function toggleExploreWatch(mint, button){
    const asset = appState.assets.find(item => item.address === mint);
    const symbol = asset?.symbol || appState.verifiedLaunchPolicyForMint(mint)?.symbol || 'TOKEN';
    if (!await appState.saveWatchlist(mint, { remove: button?.getAttribute('aria-pressed') === 'true' })) return;
    appState.renderWatchlist();
    // Keep the current cards mounted so a follow-up action on the same card
    // cannot lose its click while the watchlist changes.
    if (appState.exploreTab === 'following') appState.updateExploreViews(true);
    else if (appState.exploreRisk === 'watchlist') appState.updateExploreViews();
    else appState.renderRegistry();
    if (appState.homeLaunchTab === 'watchlist') appState.renderHomeLaunchBoard();
    appState.showToast(appState.lastKnownWatchlist.includes(mint) ? `${symbol} added to favorites` : `${symbol} removed from favorites`);
  }
  // app-source-end

  return { updateExploreViews, clearExploreFilters, refreshExploreFeedForSort, readOptionalSolFilter, openExploreTrade, positionExploreFilters, setExploreFilterOpen, toggleExploreWatch };
}
