import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export async function initializeNavigation(appState) {
  // app-source: 848
  appState.desktopSidebarToggle?.addEventListener('click', () => {
    appState.setDesktopSidebarCollapsed(!document.documentElement.classList.contains('sidebar-collapsed'));
  });
  // app-source-end

  // app-source: 849
  appState.setDesktopSidebarCollapsed(document.documentElement.classList.contains('sidebar-collapsed'));
  // app-source-end

  // app-source: 851
  document.querySelector('#open-menu').addEventListener('click', () => appState.setMenuOpen(true));
  // app-source-end

  // app-source: 852
  document.querySelector('#close-menu').addEventListener('click', () => appState.setMenuOpen(false, true));
  // app-source-end

  // app-source: 853
  document.querySelector('#menu-backdrop').addEventListener('click', () => appState.setMenuOpen(false, true));
  // app-source-end

  // app-source: 854
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('#sidebar').classList.contains('open')) appState.setMenuOpen(false, true); });
  // app-source-end

  // app-source: 855
  const pageRouteTargets = {
    launch: '#launch-route-shell',
    list: '#list',
    explore: '#explore',
    payments: '#payments',
    'analytics-detail': '#analytics-detail',
    'my-launches': '#my-launches',
    referrals: '#referral-command-center',
    community: '#community',
    leaderboard: '#leaderboard',
    airdrops: '#airdrops',
    buybacks: '#buybacks',
    'capital-flow': '#capital-flow',
    docs: '#docs',
    profile: '#profile',
    privacy: '#privacy',
    paid: '#paid',
  };
  initializeAppState(appState, 'pageRouteTargets', pageRouteTargets);
  // app-source-end

  // app-source: 856
  const mergedPageRoutes = { community: 'my-launches', 'capital-flow': 'analytics-detail', buybacks: 'paid' };
  initializeAppState(appState, 'mergedPageRoutes', mergedPageRoutes);
  // app-source-end

  // app-source: 857
  let pageRouteFocusRequested = false;
  initializeAppState(appState, 'pageRouteFocusRequested', pageRouteFocusRequested);
  // app-source-end

  // app-source: 861
  const routeGuideCopy = {
    payments: { group: 'Workspace', state: 'Confirmed payments', description: 'See rewards linked to your wallet and check what is ready to claim.', primary: ['View analytics', '#analytics-detail'], secondary: ['How claims work', '#docs'] },
    'analytics-detail': { group: 'Workspace', state: 'Platform activity', description: 'Explore launches, fees, payments, trades, airdrops, referrals, and burns.', primary: ['See capital flow', '#capital-flow'], secondary: ['Explore launches', '#explore'] },
    'my-launches': { group: 'Build', state: 'Your portfolio', description: 'See your launches, market activity, and token actions together.', primary: ['Launch a project', '#launch'], secondary: ['Launch guide', '#docs'] },
    referrals: { group: 'Growth', state: 'Connect wallet to claim', description: 'Share your invite link and follow creator activity and rewards.', primary: ['How rewards work', '#referral-faq'], secondary: ['Explore launches', '#explore'] },
    community: { group: 'Growth', state: 'Account favorites', description: 'Sign in with the same X account to sync favorite tokens across devices.', primary: ['Find launches', '#explore'], secondary: ['See airdrops', '#airdrops'] },
    leaderboard: { group: 'Growth', state: 'Confirmed activity', description: 'Explore creator and $FUNDED burn rankings.', primary: ['Explore launches', '#explore'], secondary: ['View service status', '#docs'] },
    airdrops: { group: 'Growth', state: 'Claim status', description: 'Check planned airdrops, eligibility, and claims for each launch.', primary: ['Explore launches', '#explore'], secondary: ['Claim guide', '#docs'] },
    buybacks: { group: 'Protocol', state: 'Buy and burn', description: 'Buy or burn $FUNDED and check confirmed transactions.', primary: ['View my projects', '#my-launches'], secondary: ['Read the guide', '#docs'] },
    'capital-flow': { group: 'Protocol', state: 'Example calculator', description: 'Enter any creator-fee amount to see how every destination is calculated. This preview never moves funds.', primary: ['View payments', '#payments'], secondary: ['Read the policy', '#docs'] },
    docs: { group: 'Protocol', state: 'Help and guides', description: 'Learn how launches, rewards, and wallet approvals work.', primary: ['Open launch', '#launch'], secondary: ['See capital flow', '#capital-flow'] },
    privacy: { group: 'Protocol', state: 'Information', description: 'Understand what the browser stores, what the wallet signs, and how to verify a transaction safely.', primary: ['Wallet profile', '#profile'], secondary: ['Back to overview', '#overview'] },
    paid: { group: 'Protocol', state: 'Policy preview', description: 'See how $FUNDED supports community rewards, referrals, operations, and permanent token burns.', primary: ['See buybacks', '#buybacks'], secondary: ['Read the docs', '#docs'] },
  };
  initializeAppState(appState, 'routeGuideCopy', routeGuideCopy);
  // app-source-end

  // app-source: 864
  document.querySelectorAll('.nav-item, .profile-row').forEach(item => item.addEventListener('click', () => appState.setMenuOpen(false)));
  // app-source-end

  // app-source: 865
  appState.syncPageRoute();
  // app-source-end

  // app-source: 866
  document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => {
    const href = link.getAttribute('href');
    if (href !== '#launch' && !link.dataset.info) appState.closeDialog('launch-dialog');
    if (!link.dataset.info && href !== '#referral-faq') {
      appState.requestPageRouteFocus();
      if (href === location.hash) requestAnimationFrame(() => {
        if (!appState.pageRouteFocusRequested) return;
        appState.pageRouteFocusRequested = false;
        appState.focusCurrentPageRoute();
      });
    }
  }));
  // app-source-end

  // app-source: 867
  window.addEventListener('hashchange', () => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    if (location.hash !== '#launch') appState.closeDialog('launch-dialog');
    appState.syncPageRoute();
    if (appState.pageRouteFocusRequested) {
      appState.pageRouteFocusRequested = false;
      requestAnimationFrame(appState.focusCurrentPageRoute);
    }
  });
  // app-source-end

  // app-source: 868
  const existingProvider = appState.getProvider();
  initializeAppState(appState, 'existingProvider', existingProvider);
  // app-source-end

  // app-source: 869
  if (appState.APP_MAINNET_READ_ONLY) {
    const banner = document.createElement('div');
    banner.id = 'mainnet-readonly-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'Read-only workspace · wallet signing and financial actions disabled';
    document.body.prepend(banner);
  } else {
    const phantomAvailableAtStartup = Boolean(appState.phantomProvider());
    if (appState.existingProvider?.isConnected && appState.walletAddress(appState.existingProvider) && !appState.wasWalletManuallyDisconnected()) appState.activateWallet(appState.existingProvider);
    if (!appState.wallet && phantomAvailableAtStartup) await appState.restoreTrustedPhantomWallet();
    if (!appState.wallet) await appState.mobileWallet.restore();
    if (!appState.wallet && !phantomAvailableAtStartup) void appState.restoreTrustedPhantomWallet();
    if (!appState.wallet) await appState.connectDevWallet();
  }
  // app-source-end

  // app-source: 870
  appState.captureAppReferral();
  // app-source-end

  // app-source: 871
  appState.bindAppReferralToWallet();
  // app-source-end

  // app-source: 872
  appState.updateReferralLink();
  // app-source-end

  // app-source: 873
  appState.updateOnboardingProgress();
  // app-source-end

  // app-source: 874
  appState.renderAirdropClaims();
  // app-source-end

  // app-source: 875
  appState.renderCreatorLaunches();
  // app-source-end

  // app-source: 876
  appState.loadVerifiedLaunchPolicies().catch(() => {});
  // app-source-end

  // app-source: 877
  void appState.loadVerifiedBoosts();
  // app-source-end

  // app-source: 878
  appState.createRoutePoller({ run: signal => appState.loadVerifiedLaunchPolicies(signal), active: () => appState.coinRouteRequested() || ['overview', 'explore', 'my-launches', 'payments', 'airdrops', 'community'].includes(appState.requestedPageRoute()), intervalMs: 60_000 });
  // app-source-end

  // app-source: 879
  appState.createRoutePoller({ run: signal => appState.loadVerifiedBoosts(signal), active: () => appState.coinRouteRequested() || ['overview', 'explore', 'list'].includes(appState.requestedPageRoute()), intervalMs: 60_000 });
  // app-source-end

  // app-source: 880
  appState.renderBuybackDashboard();
  // app-source-end

  // app-source: 881
  void appState.loadBuybackNetworkState();
  // app-source-end

  // app-source: 882
  appState.createRoutePoller({ run: signal => appState.loadBuybackNetworkState(signal), active: () => ['buybacks', 'paid', 'payments'].includes(appState.requestedPageRoute()), intervalMs: 60_000 });
  // app-source-end

  // app-source: 883
  void appState.refreshFundedBuyRoute();
  // app-source-end

  // app-source: 884
  void appState.refreshLaunchTierPricing();
  // app-source-end

  // app-source: 885
  appState.createRoutePoller({ run: signal => appState.refreshFundedBuyRoute(signal), active: () => !appState.fundedBuyBusy && ['buybacks', 'paid'].includes(appState.requestedPageRoute()), intervalMs: 60_000 });
  // app-source-end

  // app-source: 886
  appState.createRoutePoller({ run: () => appState.refreshLaunchTierPricing(), active: () => appState.requestedPageRoute() === 'launch', intervalMs: 60_000 });
  // app-source-end

  // app-source: 887
  appState.renderPublishedFeeRates();
  // app-source-end

  // app-source: 888
  appState.renderFeeFlowCalculator();
  // app-source-end

  // app-source: 889
  // Launch controls stay gated by their verified state while the workspace renders.
  void Promise.allSettled([appState.refreshFeeRouterConfig(), appState.refreshXFeeStatus()]);
  // app-source-end

  // app-source: 890
  appState.renderLaunchBurnSelection();
  // app-source-end

  // app-source: 891
  appState.updateLaunchPreview();
  // app-source-end

  // app-source: 892
  appState.updateCostSummary();
  // app-source-end

  // app-source: 893
  appState.updateLaunchButton();
  // app-source-end

  // app-source: 894
  appState.observeWalletProvider(appState.getProvider());
  // app-source-end

  // app-source: 895
  window.addEventListener('focus', appState.reconcileWalletState);
  // app-source-end

  // app-source: 896
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { appState.reconcileWalletState(); appState.refreshQuoteClocks(); appState.renderPendingLaunchReview(); } });
  // app-source-end

  // app-source: 897
  const simulateButton = document.querySelector('#simulate-button');
  initializeAppState(appState, 'simulateButton', simulateButton);
  // app-source-end

  // app-source: 898
  if (appState.simulateButton && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') appState.simulateButton.hidden = true;
  // app-source-end

  // app-source: 899
  // Token detail route. Every displayed value comes from Solana RPC or the Pump
  // bonding-curve account. Values that require an off-chain indexer stay explicit.
  const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
  initializeAppState(appState, 'TOKEN_METADATA_PROGRAM_ID', TOKEN_METADATA_PROGRAM_ID);
  // app-source-end

  // app-source: 900
  let coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
  initializeAppState(appState, 'coinActivity', coinActivity);
  // app-source-end

}
