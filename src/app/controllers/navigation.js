// Dependencies and mutable application state are read live through appState.
export function createNavigationController(appState) {
  // app-source: 847
  function setDesktopSidebarCollapsed(collapsed){
    const isCollapsed = Boolean(collapsed);
    document.documentElement.classList.toggle('sidebar-collapsed', isCollapsed);
    if (appState.desktopSidebarToggle) {
      appState.desktopSidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
      appState.desktopSidebarToggle.setAttribute('aria-label', isCollapsed ? 'Expand navigation' : 'Minimize navigation');
      appState.desktopSidebarToggle.title = isCollapsed ? 'Expand navigation' : 'Minimize navigation';
      appState.desktopSidebarToggle.querySelector('span').innerHTML = appState.icon(isCollapsed ? 'chevronRight' : 'chevronLeft');
    }
    try { localStorage.setItem(appState.DESKTOP_SIDEBAR_KEY, String(isCollapsed)); } catch {}
  }
  // app-source-end

  // app-source: 850
  function setMenuOpen(open, restoreFocus = false){
    document.querySelector('#sidebar').classList.toggle('open', open);
    document.querySelector('#menu-backdrop').hidden = !open;
    document.querySelector('#open-menu').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    if (open) document.querySelector('#close-menu').focus();
    else if (restoreFocus) document.querySelector('#open-menu').focus();
  }
  // app-source-end

  // app-source: 858
  function requestPageRouteFocus(){
    appState.pageRouteFocusRequested = true;
  }
  // app-source-end

  // app-source: 859
  function focusCurrentPageRoute(){
    const route = appState.requestedPageRoute();
    const routeTarget = appState.pageRouteTargets[location.hash.slice(1)] || appState.pageRouteTargets[route];
    const selectors = route === 'overview'
      ? ['.hero-section h1']
      : route === 'launch'
        ? ['#launch-title']
        : ['#route-guide:not([hidden]) #route-guide-title', routeTarget ? `${routeTarget} h1, ${routeTarget} h2` : ''];
    const heading = selectors.filter(Boolean)
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .find(candidate => candidate.getClientRects().length > 0);
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  // app-source-end

  // app-source: 860
  function requestedPageRoute(){
    if (/^\/pilot\/?$/.test(location.pathname) && !location.hash) return 'launch';
    if (/^\/funded\/?$/.test(location.pathname) && !location.hash) return 'paid';
    if (/^\/list\/?$/.test(location.pathname) && !location.hash) return 'list';
    if (/^\/explore\/?$/.test(location.pathname)) return 'explore';
    const hash = location.hash.replace(/^#/, '');
    if (hash === 'pilot') return 'launch';
    if (hash === 'overview' || hash === '') return 'overview';
    if (hash.startsWith('coin/')) return 'overview';
    if (hash === 'referral-faq') return 'referrals';
    if (hash.startsWith('docs/')) return 'docs';
    if (hash === 'funded-holder-token-rewards') return 'payments';
    return appState.pageRouteTargets[hash] ? appState.mergedPageRoutes[hash] || hash : 'overview';
  }
  // app-source-end

  // app-source: 862
  function normalizeDirectPagePathForHashRoute(){
    if (!location.hash || location.hash.startsWith('#coin/')) return;
    const directPath = location.pathname.startsWith('/token/') || location.pathname.startsWith('/launch/coin/') || location.pathname.startsWith('/wallet/');
    if (directPath) history.replaceState({}, '', `/${location.search}${location.hash}`);
  }
  // app-source-end

  // app-source: 863
  function syncPageRoute(){
    appState.normalizeDirectPagePathForHashRoute();
    const requestedHash = location.hash.replace(/^#/, '');
    const infoRoute = appState.infoDialogRoutes.has(requestedHash) ? requestedHash : '';
    const infoDialog = document.querySelector('#info-dialog');
    if (infoRoute && (!infoDialog.open || infoDialog.dataset.infoKind !== infoRoute)) appState.openInfoDialog(infoRoute, { routeDriven: true });
    else if (!infoRoute && infoDialog.open && infoDialog.dataset.routeDriven === 'true') appState.closeDialog('info-dialog');
    const route = appState.requestedPageRoute();
    document.body.classList.remove('page-route', ...Object.keys(appState.pageRouteTargets).map(key => `page-route-${key}`), 'page-route-overview', 'page-route-coin', 'page-route-wallet');
    document.body.classList.add('page-route', `page-route-${route}`);
    if (requestedHash === 'community') document.body.classList.add('page-route-community');
    if (requestedHash === 'capital-flow') document.body.classList.add('page-route-capital-flow');
    if (requestedHash === 'buybacks') document.body.classList.add('page-route-buybacks');
    if (appState.coinRouteRequested()) { document.body.classList.remove('page-route-overview'); document.body.classList.add('page-route-coin'); }
    if (appState.walletRouteRequested()) { document.body.classList.remove('page-route-overview'); document.body.classList.add('page-route-wallet'); }
    if (route === 'explore') document.body.classList.add('explore-route');
    else document.body.classList.remove('explore-route');
    const creatorSupportRoute = requestedHash === 'creators' || /^creator\/\d{1,24}$/.test(requestedHash)
      || (!requestedHash && /^\/creator\/x\/\d{1,24}\/?$/.test(location.pathname));
    const navRoute = appState.coinRouteRequested() || creatorSupportRoute ? 'explore'
      : appState.walletRouteRequested() || requestedHash === 'creator-settings' ? 'my-launches' : route;
    document.querySelectorAll('.nav-item').forEach(item => {
      const hrefRoute = item.getAttribute('href') === '/funded' ? 'paid' : item.getAttribute('href')?.replace(/^#/, '');
      item.classList.toggle('active', hrefRoute === navRoute);
      if (hrefRoute === navRoute) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    let copy = {
      overview: ['Overview', 'Verified activity and next steps'],
      explore: ['Explore', 'Verified launches and market signals'],
      list: ['Get listed', 'Listing status and token mint check'],
      payments: ['Rewards', 'Claims and payout receipts'],
      'analytics-detail': ['Analytics', 'Protocol flow and indexed activity'],
      launch: ['Create a coin', 'Create and review a Devnet coin'],
      'my-launches': ['Portfolio', 'Launches, favorites and followed wallets'],
      referrals: ['Referrals', 'Track qualified growth'],
      community: ['Favorites', 'Favorites and verified signals'],
      leaderboard: ['Leaderboard', 'Ranked community contribution'],
      airdrops: ['Airdrops', 'Eligibility and claim records'],
      buybacks: ['Burn $FUNDED', 'Supply reduction and burn receipts'],
      'capital-flow': ['Capital flow', 'Follow the published allocation'],
      docs: ['Docs', 'Guides, safety, and disclosures'],
      profile: ['Profile', 'Wallet and signing safety'],
      privacy: ['Privacy', 'Wallet and browser data'],
      paid: ['$FUNDED', 'Token policy and availability'],
    }[route] || ['Overview', 'Verified activity and next steps'];
    if (appState.coinRouteRequested()) copy = ['Token', 'Market activity and trade'];
    if (appState.walletRouteRequested()) copy = ['Wallet', 'Balances and confirmed activity'];
    if (requestedHash === 'community') copy = ['Favorites', 'Favorite tokens and followed wallets'];
    if (requestedHash === 'capital-flow') copy = ['Capital flow', 'Published fee allocation'];
    if (requestedHash === 'buybacks') copy = ['Buy & burn', '$FUNDED actions and receipts'];
    const routeContext = document.querySelector('#route-context');
    if (routeContext) {
      const label = routeContext.querySelector('[data-route-label]');
      const description = routeContext.querySelector('[data-route-description]');
      if (label) label.textContent = copy[0];
      if (description) description.textContent = copy[1];
    }
    const guide = appState.routeGuideCopy[route];
    const routeGuide = document.querySelector('#route-guide');
    routeGuide.hidden = !guide;
    if (guide) {
      document.querySelector('#route-guide-group').textContent = guide.group;
      document.querySelector('#route-guide-state').textContent = route === 'referrals' ? document.documentElement.dataset.referralStatus || (appState.connectedWalletAddress ? 'Verify wallet' : 'Connect wallet') : guide.state;
      document.querySelector('#route-guide-title').textContent = copy[0];
      document.querySelector('#route-guide-description').textContent = guide.description;
      for (const [id, action] of [['#route-guide-primary', guide.primary], ['#route-guide-secondary', guide.secondary]]) {
        const link = document.querySelector(id);
        link.href = action[1];
        link.firstChild.textContent = action[0] + ' ';
      }
    }
    if (route === 'buybacks' || route === 'paid' || (route === 'airdrops' && appState.connectedWalletAddress)) void appState.loadFundedBurnState();
    if (location.hash === '#referral-faq') requestAnimationFrame(() => {
      const faq = document.querySelector('#referral-faq');
      if (faq) faq.tabIndex = -1;
      faq?.scrollIntoView({ block: 'start', behavior: 'auto' });
      faq?.focus({ preventScroll: true });
    });
    else if (route !== 'overview') window.scrollTo({ top: 0, behavior: 'auto' });
    window.dispatchEvent(new CustomEvent('funded:route-change', {detail: {route}}));
  }
  // app-source-end

  return { setDesktopSidebarCollapsed, setMenuOpen, requestPageRouteFocus, focusCurrentPageRoute, requestedPageRoute, normalizeDirectPagePathForHashRoute, syncPageRoute };
}
