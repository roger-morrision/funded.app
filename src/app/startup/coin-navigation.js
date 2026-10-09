// Startup runs in the order declared in start.js.
export function initializeCoinNavigation(appState) {
  // app-source: 986
  if (appState.coinRouteRequested()) appState.showCoinPage();
  else if (appState.walletRouteRequested()) appState.showWalletPage();
  else if (!appState.exploreInitialLoadStarted && !appState.exploreUpdatedAt) appState.showCoinPage(false);
  // app-source-end

  // app-source: 987
  window.addEventListener('hashchange', () => { if (appState.coinRouteRequested()) appState.showCoinPage(); else if (appState.walletRouteRequested()) appState.showWalletPage(); else { appState.showCoinPage(false); appState.showWalletPage(false); } });
  // app-source-end

  // app-source: 988
  window.addEventListener('popstate', () => { if (appState.coinRouteRequested()) appState.showCoinPage(); else if (appState.walletRouteRequested()) appState.showWalletPage(); else { appState.showCoinPage(false); appState.showWalletPage(false); } });
  // app-source-end

  // app-source: 989
  document.querySelector('#asset-grid')?.addEventListener('click', event => { if (event.target.closest('button, a')) return; const card = event.target.closest('.asset-card'); const mint = card?.dataset.mint; if (!mint) return; location.href = `/token/${encodeURIComponent(mint)}`; });
  // app-source-end

  // app-source: 990
  document.querySelector('#coin-page')?.addEventListener('click', async event => {
    const hideAuthor = event.target.closest('[data-chat-hide]');
    const unhideAuthors = event.target.closest('[data-chat-unhide]');
    if (hideAuthor || unhideAuthors) {
      try {
        if (hideAuthor) appState.hideChatAuthor(appState.EXPLORE_CLUSTER, hideAuthor.dataset.chatHide);
        else appState.resetHiddenChatAuthors(appState.EXPLORE_CLUSTER);
        appState.renderCoinCommunityPanel();
        if (document.querySelector('[data-coin-tab="chat"].active')) appState.renderCoinActivityTab();
        appState.showToast(hideAuthor ? 'Wallet hidden on this device.' : 'Hidden wallets are visible again.');
      } catch { appState.showToast('Device storage is unavailable. Your chat preferences could not be saved.'); }
      return;
    }
    const reportMessage = event.target.closest('[data-chat-report]');
    if (reportMessage) {
      reportMessage.disabled = true;
      try { await appState.tokenChatRequest('report', { messageId: reportMessage.dataset.chatReport, reason: 'spam-or-scam' }); appState.showToast('Report recorded for moderation review.'); }
      catch (error) { appState.showToast(error.message || 'Report could not be recorded.'); }
      finally { reportMessage.disabled = false; }
      return;
    }
    const deleteMessage = event.target.closest('[data-chat-delete]');
    if (deleteMessage) {
      deleteMessage.disabled = true;
      try { await appState.tokenChatRequest('delete', { messageId: deleteMessage.dataset.chatDelete }); await appState.refreshCoinChat(); appState.showToast('Message deleted'); }
      catch (error) { appState.showToast(error.message || 'The message could not be deleted'); deleteMessage.disabled = false; }
      return;
    }
    const creatorLink = event.target.closest('.coin-creator-link, #coin-creator-by');
    if (creatorLink) { event.preventDefault(); history.pushState({}, '', creatorLink.href); appState.showWalletPage(); return; }
    const trade = event.target.closest('#coin-trade-button');
    if (trade) return;
    const chartMetric = event.target.closest('[data-coin-chart-metric]');
    if (chartMetric){ appState.coinChartMetric = chartMetric.dataset.coinChartMetric; appState.renderCoinPricePath(); return; }
    const chartPeriod = event.target.closest('[data-coin-chart-period]');
    if (chartPeriod){ appState.coinChartPeriod = chartPeriod.dataset.coinChartPeriod; appState.renderCoinPricePath(); return; }
    const chartUnit = event.target.closest('[data-coin-chart-unit]');
    if (chartUnit){ appState.coinChartUnit = chartUnit.dataset.coinChartUnit; appState.renderCoinPricePath(); return; }
    const pulsePeriod = event.target.closest('[data-coin-pulse-period]');
    if (pulsePeriod){ appState.coinPulsePeriod = pulsePeriod.dataset.coinPulsePeriod; appState.renderCoinPulse(); return; }
    const refresh = event.target.closest('#coin-refresh');
    if (refresh){ const mint = appState.getCoinMintAddress(); appState.resetCoinSurface(mint); appState.loadCoinOnChain(mint); return; }
    const watch = event.target.closest('#coin-watch');
    if (watch){ const mint = appState.getCoinMintAddress(); if (!mint || !await appState.saveWatchlist(mint, { remove: watch.getAttribute('aria-pressed') === 'true' })) return; appState.renderWatchlist(); appState.setWatchButtonState(watch, appState.lastKnownWatchlist.includes(mint)); return; }
    const share = event.target.closest('#coin-share-link');
     if (share){ event.preventDefault(); appState.openCoinShare(appState.getCoinMintAddress(), document.querySelector('#coin-symbol')?.textContent?.trim() || 'Coin', document.querySelector('#coin-page-title')?.textContent?.trim() || ''); return; }
    const boost = event.target.closest('#coin-boost');
    if (boost) { const mint = appState.getCoinMintAddress(); if (mint) appState.openExploreBoost(mint); return; }
    const copy = event.target.closest('#coin-copy-address, #coin-copy-full');
    if (copy){ const address = appState.getCoinMintAddress(); if (!address) return appState.showToast('No mint address in this route'); try { await navigator.clipboard.writeText(address); appState.showToast('Token address copied'); } catch { appState.showToast(address); } }
    const clearTradeFilters = event.target.closest('#coin-trade-clear');
    if (clearTradeFilters){ appState.coinTradeFilter = 'all'; appState.coinTradeSort = { key: 'date', direction: 'desc' }; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelectorAll('#coin-page [data-coin-trade-input]').forEach(input => { input.value = input.dataset.coinTradeInput === 'side' ? 'all' : ''; }); appState.renderCoinActivityTab(); return; }
    const tradeSort = event.target.closest('[data-coin-trade-sort]');
    if (tradeSort){ const key = tradeSort.dataset.coinTradeSort; appState.coinTradeSort = { key, direction: appState.coinTradeSort.key === key && appState.coinTradeSort.direction === 'asc' ? 'desc' : 'asc' }; appState.renderCoinActivityTab(); document.querySelector(`[data-coin-trade-sort="${key}"]`)?.focus(); return; }
    const columnFilter = event.target.closest('[data-coin-column-filter]');
    if (columnFilter){ const key = columnFilter.dataset.coinColumnFilter; if (key === 'trader') { appState.coinTradeOpenFilter = null; appState.renderCoinActivityTab(); document.querySelector('#coin-trade-wallet')?.focus(); return; } appState.coinTradeOpenFilter = appState.coinTradeOpenFilter === key ? null : key; appState.renderCoinActivityTab(); if (appState.coinTradeOpenFilter) document.querySelector(`#coin-trade-refine [data-coin-filter-panel="${key}"] input, #coin-trade-refine [data-coin-filter-panel="${key}"] select`)?.focus(); else document.querySelector(`[data-coin-column-filter="${key}"]`)?.focus(); return; }
    const holderTrades = event.target.closest('[data-coin-holder-trades]');
    if (holderTrades){ const wallet = holderTrades.dataset.coinHolderTrades; if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet || '')) return; document.querySelector('#coin-trade-wallet').value = wallet; appState.coinTradeFilter = 'all'; appState.coinTradeOpenFilter = null; const typeInput = document.querySelector('[data-coin-trade-input="side"]'); if (typeInput) typeInput.value = 'all'; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); document.querySelectorAll('[data-coin-tab]').forEach(button => button.classList.toggle('active', button.dataset.coinTab === 'trades')); appState.setCoinTabLabels(); appState.renderCoinActivityTab(); document.querySelector('#coin-trade-wallet')?.focus(); return; }
    const tradeFilter = event.target.closest('[data-coin-trade-filter]');
    if (tradeFilter){ appState.coinTradeFilter = tradeFilter.dataset.coinTradeFilter; const typeInput = document.querySelector('[data-coin-trade-input="side"]'); if (typeInput) typeInput.value = appState.coinTradeFilter; document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button === tradeFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }); appState.renderCoinActivityTab(); return; }
    const tab = event.target.closest('[data-coin-tab]');
    if (tab){ document.querySelectorAll('[data-coin-tab]').forEach(item => item.classList.toggle('active', item === tab)); appState.setCoinTabLabels(); appState.renderCoinActivityTab(); }
  });
  // app-source-end

  // app-source: 991
  document.querySelector('#wallet-page')?.addEventListener('click', async event => {
    const follow = event.target.closest('#wallet-follow');
    if (follow) {
      const address = appState.getWalletDetailAddress();
      appState.saveFollowedWallet(address, { remove: follow.getAttribute('aria-pressed') === 'true', roles: appState.walletRoles(address) });
      return;
    }
    const filter = event.target.closest('[data-wallet-filter]');
    if (filter) { appState.walletDetailFilter = filter.dataset.walletFilter; appState.renderWalletDetail(); return; }
    const tab = event.target.closest('[data-wallet-tab]');
    if (tab) {
      appState.walletDetailTab = tab.dataset.walletTab;
      appState.renderWalletDetail();
      return;
    }
    const copy = event.target.closest('#wallet-copy-address');
    if (!copy) return;
    const address = appState.getWalletDetailAddress();
    if (!address) return appState.showToast('No wallet address in this route');
    try { await navigator.clipboard.writeText(address); appState.showToast('Wallet address copied'); } catch { appState.showToast(address); }
  });
  // app-source-end

  // app-source: 992
  document.querySelector('.wallet-detail-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-wallet-tab]')];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
  // app-source-end

}
