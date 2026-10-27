import { openCoinRecord } from '../../features/coin/records-navigation.js';

function bindTokenControlFocus(appState) {
  const page = document.querySelector('#coin-page');
  const controls = '[data-coin-chart-period],[data-coin-chart-metric],[data-coin-chart-unit],[data-coin-pulse-period]';
  let frame = 0, episode = 0, release = () => {};
  const cancel = () => { ++episode; cancelAnimationFrame(frame); frame = 0; release(); release = () => {}; };
  const current = (target, route) => document.activeElement === target && target.isConnected
    && target.getClientRects().length && !target.closest('[hidden],[inert]')
    && appState.coinRouteRequested() && location.href === route && page?.contains(target);
  const clipped = target => {
    const rect = target.getBoundingClientRect(), style = getComputedStyle(target);
    const edge = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
    const bounds = {left:0, right:innerWidth, top:0, bottom:innerHeight};
    for (const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
      if (!chrome.getClientRects().length) continue;
      if (chrome.matches('.topbar')) bounds.top = Math.max(bounds.top, chrome.getBoundingClientRect().bottom);
      else bounds.bottom = Math.min(bounds.bottom, chrome.getBoundingClientRect().top);
    }
    const rootStyle = getComputedStyle(document.documentElement);
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
      const clipX = /^(hidden|clip|auto|scroll)$/.test(css.overflowX), clipY = /^(hidden|clip|auto|scroll)$/.test(css.overflowY);
      // Propagated root/body overflow clips the viewport, not a translated box.
      if (parent === document.documentElement || (parent === document.body
        && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
        && rootStyle.contain === 'none' && css.contain === 'none')) continue;
      const left = box.left + parent.clientLeft, top = box.top + parent.clientTop;
      const right = left + parent.clientWidth, bottom = top + parent.clientHeight;
      if (clipX) { bounds.left = Math.max(bounds.left,left); bounds.right = Math.min(bounds.right,right); }
      if (clipY) { bounds.top = Math.max(bounds.top,top); bounds.bottom = Math.min(bounds.bottom,bottom); }
      if (clipX && clipY) {
        const radii = ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius']
          .map(key => Math.max(0,(parseFloat(css[key]) || 0) - parent.clientLeft));
        const points = [[rect.left-edge,rect.top-edge],[rect.right+edge,rect.top-edge],
          [rect.right+edge,rect.bottom+edge],[rect.left-edge,rect.bottom+edge]];
        const centers = [[left+radii[0],top+radii[0]],[right-radii[1],top+radii[1]],
          [right-radii[2],bottom-radii[2]],[left+radii[3],bottom-radii[3]]];
        for (let i=0;i<4;i++) {
          const [x,y] = points[i], [cx,cy] = centers[i], radius = radii[i];
          if (radius && (i===0||i===3 ? x<cx : x>cx) && (i<2 ? y<cy : y>cy)
            && (x-cx)**2 + (y-cy)**2 > radius**2) return true;
        }
      }
    }
    return rect.left-edge < bounds.left || rect.right+edge > bounds.right
      || rect.top-edge < bounds.top || rect.bottom+edge > bounds.bottom;
  };
  page?.addEventListener('focusin', event => {
    cancel();
    const target = event.target, route = location.href, owner = episode;
    if (!target.matches(controls) || !current(target, route)) return;
    const valid = () => owner === episode && current(target, route);
    const lateScroll = () => {
      if (owner !== episode) return;
      if (!valid()) return cancel();
      if (!clipped(target)) return;
      cancel(); // Unregister before revealing; queued callbacks cannot recurse.
      target.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
    };
    const input = () => { if (owner === episode) cancel(); };
    const inputs = ['keydown','pointerdown','wheel','touchstart'];
    // Native focus follows the initiating input's window capture phase. Adding
    // these here cannot see that completed phase, but catches the very next input
    // even before our first frame. No delay or timestamp-based exclusion.
    for (const name of inputs) window.addEventListener(name,input,{capture:true,passive:true});
    release = () => {
      for (const name of inputs) window.removeEventListener(name,input,true);
      window.removeEventListener('scroll',lateScroll,true);
    };
    // One post-native frame belongs only to this still-focused original node.
    frame = requestAnimationFrame(() => {
      if (owner !== episode) return;
      frame = 0;
      if (!valid()) return cancel();
      // Stop superseded native movement at its CURRENT position, never restore
      // a captured position or move focus. Reveal only an actually clipped node.
      window.scrollTo({top:window.scrollY, left:window.scrollX, behavior:'instant'});
      if (clipped(target)) target.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'});
      window.addEventListener('scroll',lateScroll,{capture:true,passive:true});
    });
  });
  page?.addEventListener('focusout', cancel);
  for (const event of ['hashchange','popstate','pagehide']) window.addEventListener(event,cancel);
}

// Startup runs in the order declared in start.js.
export function initializeCoinNavigation(appState) {
  bindTokenControlFocus(appState);
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
  document.querySelector('#asset-grid')?.addEventListener('click', event => { if (event.target.closest('button, a')) return; const card = event.target.closest('.asset-card, .explore-compact-card, .explore-launch-card'); const mint = card?.dataset.mint; if (!mint) return; location.href = `/token/${encodeURIComponent(mint)}`; });
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
    const record = event.target.closest('[data-coin-record-target]');
    if (record) { openCoinRecord(record.dataset.coinRecordTarget); return; }
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
