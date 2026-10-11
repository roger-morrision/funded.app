export function initializeExploreSearchActions(appState) {
  // app-source: 771
  document.querySelector('#global-search').addEventListener('input', event => {
    appState.exploreQuery = event.target.value;
    const field = document.querySelector('#explore-search');
    if (field) field.value = appState.exploreQuery;
    if (appState.exploreQuery && location.hash !== '#explore' && !/^\/explore\/?$/.test(location.pathname)) location.hash = '#explore';
    appState.updateExploreViews();
  });
  // app-source-end

  // app-source: 772
  document.querySelector('#search-shortcut').textContent = /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  // app-source-end

  // app-source: 773
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const search = document.querySelector('#global-search');
      if (search.getClientRects().length) {
        search.focus();
        search.select();
      } else {
        const dialog = document.querySelector('#header-search-dialog');
        if (!dialog?.open) document.querySelector('#header-search-trigger')?.click();
        else { document.querySelector('#header-search-input')?.focus(); document.querySelector('#header-search-input')?.select(); }
      }
    }
  });
  // app-source-end

  // app-source: 774
  document.querySelector('#explore-search')?.addEventListener('input', event => {
    appState.exploreQuery = event.target.value;
    const field = document.querySelector('#global-search');
    if (field && field.value !== appState.exploreQuery) field.value = appState.exploreQuery;
    appState.updateExploreViews();
  });
  // app-source-end

  // app-source: 775
  document.querySelector('#explore-sort')?.addEventListener('change', event => { appState.exploreSort = event.target.value; appState.updateExploreViews(); appState.refreshExploreFeedForSort(); });
  // app-source-end

  // app-source: 776
  document.querySelectorAll('[data-explore-sort]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    appState.exploreSort = button.dataset.exploreSort;
    const select = document.querySelector('#explore-sort');
    if (select) select.value = appState.exploreSort;
    appState.updateExploreViews();
    appState.refreshExploreFeedForSort();
  }));
  // app-source-end

  // app-source: 777
  document.querySelector('#explore-risk-filter')?.addEventListener('change', event => { appState.exploreRisk = event.target.value; appState.updateExploreViews(); });
  // app-source-end

  // app-source: 778
  document.querySelector('#explore-promotion-filter')?.addEventListener('change', event => { appState.explorePromotion = event.target.value; appState.updateExploreViews(); });
  // app-source-end

  // app-source: 779
  document.querySelector('#explore-reward-filter')?.addEventListener('change', event => { appState.exploreReward = event.target.value; appState.updateExploreViews(); });
  // app-source-end

  // app-source: 780
  document.querySelectorAll('[data-explore-window]').forEach(button => button.addEventListener('click', () => {
    if (appState.EXPLORE_CLUSTER !== 'devnet' || !['1h', '6h', '24h'].includes(button.dataset.exploreWindow)) return;
    appState.exploreWindow = button.dataset.exploreWindow;
    appState.updateExploreSortAvailability();
    appState.updateExploreViews();
  }));
  // app-source-end

  // app-source: 781
  document.querySelector('#explore-authority-filter')?.addEventListener('change', event => { appState.exploreAuthority = event.target.value; appState.updateExploreViews(); });
  // app-source-end

  // app-source: 782
  document.querySelector('#explore-max-age-hours')?.addEventListener('change', event => { appState.exploreMaxAgeHours = event.target.value ? Number(event.target.value) : null; appState.updateExploreViews(); });
  // app-source-end

  // app-source: 783
  document.querySelector('#explore-min-volume-sol')?.addEventListener('input', () => { appState.exploreMinVolumeUsd = appState.readOptionalSolFilter('#explore-min-volume-sol'); appState.updateExploreViews(); });
  // app-source-end

  // app-source: 784
  document.querySelector('#explore-min-cap-sol')?.addEventListener('input', () => { appState.exploreMinMarketCapUsd = appState.readOptionalSolFilter('#explore-min-cap-sol'); appState.updateExploreViews(); });
  // app-source-end

  // app-source: 785
  document.querySelector('#explore-min-trades')?.addEventListener('input', () => {
    appState.exploreMinTrades = appState.readOptionalSolFilter('#explore-min-trades', { integer: true });
    appState.updateExploreViews();
  });
  // app-source-end

  // app-source: 786
  document.querySelector('#explore-min-traders')?.addEventListener('input', () => {
    appState.exploreMinTraders = appState.readOptionalSolFilter('#explore-min-traders', { integer: true });
    appState.updateExploreViews();
  });
  // app-source-end

  // app-source: 787
  document.querySelector('#explore-clear-filters')?.addEventListener('click', () => appState.clearExploreFilters());
  // app-source-end

  // app-source: 790
  window.addEventListener('resize', appState.positionExploreFilters);
  // app-source-end

  // app-source: 791
  window.visualViewport?.addEventListener('resize', appState.positionExploreFilters);
  // app-source-end

  // app-source: 792
  window.visualViewport?.addEventListener('scroll', appState.positionExploreFilters);
  // app-source-end

  // app-source: 793
  document.addEventListener('scroll', event => {
    if (!document.querySelector('#explore-filter-popover')?.contains(event.target)) appState.positionExploreFilters();
  }, { capture: true, passive: true });
  // app-source-end

  // app-source: 794
  document.querySelector('#explore-filter-toggle')?.addEventListener('click', event => {
    event.stopPropagation();
    const popover = document.querySelector('#explore-filter-popover');
    appState.setExploreFilterOpen(Boolean(popover?.hidden));
  });
  // app-source-end

  // app-source: 795
  document.querySelector('#explore-filter-close')?.addEventListener('click', () => {
    appState.setExploreFilterOpen(false);
    document.querySelector('#explore-filter-toggle')?.focus();
  });
  // app-source-end

  // app-source: 796
  document.addEventListener('click', event => {
    const popover = document.querySelector('#explore-filter-popover');
    if (!popover || popover.hidden || document.querySelector('.explore-filter-wrap')?.contains(event.target)) return;
    appState.setExploreFilterOpen(false);
  });
  // app-source-end

  // app-source: 797
  document.addEventListener('keydown', event => {
    const popover = document.querySelector('#explore-filter-popover');
    if (event.key !== 'Escape' || !popover || popover.hidden) return;
    appState.setExploreFilterOpen(false);
    document.querySelector('#explore-filter-toggle')?.focus();
  });
  // app-source-end

  // app-source: 798
  document.querySelector('#explore-pulse')?.addEventListener('click', event => {
    const button = event.target.closest('[data-explore-lane]');
    if (!button) return;
    appState.exploreTab = 'new';
    appState.exploreNewLane = button.dataset.exploreLane;
    appState.exploreSort = 'newest';
    document.querySelector('#explore-sort').value = appState.exploreSort;
    appState.updateExploreViews();
    appState.refreshExploreFeedForSort();
  });
  // app-source-end

  // app-source: 799
  document.querySelector('#explore-auto-refresh')?.addEventListener('click', event => {
    appState.exploreAutoRefresh = !appState.exploreAutoRefresh;
    event.currentTarget.textContent = `Auto-refresh ${appState.exploreAutoRefresh ? 'on' : 'paused'}`;
    event.currentTarget.setAttribute('aria-pressed', String(appState.exploreAutoRefresh));
  });
  // app-source-end

  // app-source: 800
  document.querySelectorAll('[data-explore-view]').forEach(button => button.addEventListener('click', () => { appState.exploreView = button.dataset.exploreView; try { localStorage.setItem(appState.EXPLORE_VIEW_KEY, appState.exploreView); } catch {} appState.renderExploreControls(); }));
  // app-source-end

  // app-source: 801
  document.querySelector('#explore-benefit-leaders')?.addEventListener('click', event => {
    const button = event.target.closest('[data-explore-leader-sort]');
    if (!button || button.disabled) return;
    appState.exploreSort = button.dataset.exploreLeaderSort;
    const select = document.querySelector('#explore-sort');
    if (select) select.value = appState.exploreSort;
    appState.updateExploreViews();
    appState.refreshExploreFeedForSort();
  });
  // app-source-end

  // app-source: 802
  document.querySelectorAll('[data-explore-stage]').forEach(button => button.addEventListener('click', () => { appState.exploreStage = button.dataset.exploreStage; document.querySelectorAll('[data-explore-stage]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); appState.updateExploreViews(); }));
  // app-source-end

  // app-source: 803
  document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    const previousTab = appState.exploreTab;
    document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    const tab = button.dataset.exploreTab;
    appState.exploreTab = tab;
    if (tab === 'new') { appState.exploreNewLane = 'all'; appState.exploreSort = 'newest'; document.querySelector('#explore-sort').value = 'newest'; }
    else if (tab === 'trending' && !['following', 'favorites'].includes(previousTab)) { appState.exploreSort = document.querySelector('#explore-sort option[value="volume"]:not(:disabled)') ? 'volume' : 'recent-trade'; document.querySelector('#explore-sort').value = appState.exploreSort; }
    appState.updateExploreViews(true);
    if (!['following', 'favorites'].includes(tab)) appState.refreshExploreFeedForSort();
  }));
  // app-source-end

  // app-source: 804
  document.querySelector('#scanner-pagination')?.addEventListener('click', event => {
    const button = event.target.closest('[data-registry-page]');
    if (!button || button.disabled) return;
    const requested = button.dataset.registryPage;
    appState.registryPage = requested === 'next' ? appState.registryPage + 1 : requested === 'prev' ? appState.registryPage - 1 : Number(requested);
    appState.renderRegistry();
    document.querySelector('.scanner-scroll')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  // app-source-end

  // app-source: 805
  document.querySelector('#asset-grid').addEventListener('click', async event => {
    const boost = event.target.closest('[data-boost-mint]');
    if (boost) { appState.openExploreBoost(boost.dataset.boostMint); return; }
    const button = event.target.closest('.watch-button');
    const share = event.target.closest('.share-asset');
    const emptyAction = event.target.closest('[data-explore-empty-action]');
    if (emptyAction) { if (emptyAction.dataset.exploreEmptyAction === 'clear') appState.clearExploreFilters(); else appState.loadOnchainExploreData().catch(() => appState.showToast('Retry could not verify Devnet data.')); return; }
    if (share) { appState.openCoinShare(share.dataset.shareMint || '', share.dataset.shareSymbol || 'Coin', share.dataset.shareName || ''); return; }
   if (!button) return;
    appState.toggleExploreWatch(button.dataset.mint, button);
  });
  // app-source-end

  // app-source: 807
  document.addEventListener('click', event => {
    const watch = event.target.closest('.token-card-action-watch');
    if (watch) {
      event.preventDefault();
      event.stopPropagation();
      if (watch.dataset.mint) appState.toggleExploreWatch(watch.dataset.mint, watch);
      return;
    }
    const share = event.target.closest('.token-card-action-share');
    if (share) {
      event.preventDefault();
      event.stopPropagation();
      appState.openCoinShare(share.dataset.shareMint || '', share.dataset.shareSymbol || 'Coin', share.dataset.shareName || '');
    }
  }, true);
  // app-source-end

  // app-source: 808
  document.querySelector('#watchlist-items').addEventListener('click', async event => {
    const boost = event.target.closest('[data-boost-mint]');
    if (boost) { appState.openExploreBoost(boost.dataset.boostMint); return; }
    const trade = event.target.closest('[data-trade-mint]');
    if (trade) { appState.openExploreTrade(trade.dataset.tradeMint); return; }
    const retry = event.target.closest('[data-watch-retry]');
    if (retry) { retry.disabled = true; void Promise.allSettled([appState.loadVerifiedLaunchPolicies(), appState.loadOnchainExploreData()]).then(() => appState.renderWatchlist()); return; }
    const button = event.target.closest('[data-remove-watch]');
    if (!button) return;
    if (!await appState.saveWatchlist(button.dataset.removeWatch, { remove: true })) return;
    appState.updateExploreViews();
  });
  // app-source-end

  // app-source: 809
  document.querySelector('#creator-launch-empty')?.addEventListener('click', event => {
    const boost = event.target.closest('[data-boost-mint]');
    if (boost) { appState.openExploreBoost(boost.dataset.boostMint); return; }
    const watch = event.target.closest('.watch-button');
    if (watch) { appState.toggleExploreWatch(watch.dataset.mint, watch); return; }
    const share = event.target.closest('.share-asset');
    if (share) { appState.openCoinShare(share.dataset.shareMint || '', share.dataset.shareSymbol || 'Coin', share.dataset.shareName || ''); return; }
    const trade = event.target.closest('[data-trade-mint]');
    if (trade) { appState.openExploreTrade(trade.dataset.tradeMint); return; }
    if (event.target.closest('button, a')) return;
    const mint = event.target.closest('.home-launch-card')?.dataset.mint;
    if (mint) location.href = `/token/${encodeURIComponent(mint)}`;
  });
  // app-source-end
}
