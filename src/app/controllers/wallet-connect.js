// Dependencies and mutable application state are read live through appState.
export function createWalletConnectController(appState) {
  // app-source: 647
  function setWalletState(message, detail = '', connected = false){
    connected = Boolean(connected && appState.wallet && appState.connectedWalletAddress === appState.walletAddress(appState.wallet));
    document.documentElement.dataset.connectedWallet = connected ? appState.connectedWalletAddress : '';
    document.documentElement.dataset.creatorClaimSigning = String(Boolean(connected && !appState.wallet?.readOnly && typeof appState.wallet?.signMessage === 'function'));
    window.dispatchEvent(new Event('funded:reward-identity-change'));
    const signingReady = connected && appState.canSignTransactions(appState.wallet);
    const header = document.querySelector('#connect-button');
    const walletPopover = document.querySelector('#wallet-popover');
    const keepPopoverOpen = Boolean(connected && walletPopover && !walletPopover.hidden);
    header.classList.toggle('wallet-pill-connected', connected);
    if (connected) {
      const walletIcon = document.createElement('span'); walletIcon.className = 'header-wallet-icon'; walletIcon.setAttribute('aria-hidden', 'true');
      const solanaMark = document.createElement('span'); solanaMark.className = 'header-solana-mark'; solanaMark.setAttribute('aria-hidden', 'true');
      const balance = document.createElement('span'); balance.className = 'header-wallet-balance'; balance.id = 'header-wallet-balance'; balance.textContent = '—';
      const chevron = document.createElement('span'); chevron.className = 'header-wallet-chevron'; chevron.setAttribute('aria-hidden', 'true'); chevron.textContent = '⌄';
      header.replaceChildren(walletIcon, solanaMark, balance, chevron);
      header.setAttribute('aria-label', `Wallet ${appState.connectedWalletAddress.slice(0, 4)}…${appState.connectedWalletAddress.slice(-4)}`);
    } else {
      const arrow = document.createElement('span'); arrow.textContent = '↗';
      header.replaceChildren(document.createTextNode('Connect wallet '), arrow);
      header.setAttribute('aria-label', 'Connect wallet');
    }
    header.removeAttribute('title');
    header.setAttribute('aria-expanded', String(keepPopoverOpen));
    if (walletPopover && !keepPopoverOpen) walletPopover.hidden = true;
    header.onclick = connected ? event => {
      event.stopPropagation();
      if (!walletPopover) return;
      const opening = walletPopover.hidden;
      walletPopover.hidden = !opening;
      header.setAttribute('aria-expanded', String(opening));
      if (opening) void appState.refreshWalletBalance({ force: true });
    } : appState.connectWallet;
    const popoverAddress = document.querySelector('#wallet-popover-address');
    const popoverNetwork = document.querySelector('#wallet-popover-network');
    const popoverDetailLink = document.querySelector('#wallet-popover-detail-link');
    if (popoverAddress) popoverAddress.textContent = connected ? `${appState.connectedWalletAddress.slice(0, 4)}…${appState.connectedWalletAddress.slice(-4)}` : 'Wallet';
    if (popoverNetwork) popoverNetwork.textContent = connected ? 'Solana' : 'Not connected';
    if (popoverDetailLink) popoverDetailLink.href = connected ? `/wallet/${encodeURIComponent(appState.connectedWalletAddress)}` : '#profile';
    appState.renderWalletFundedBalance();
    const sidebarName = document.querySelector('#sidebar-wallet-name');
    const sidebarAddress = document.querySelector('#sidebar-wallet-address');
    const sidebarAvatar = document.querySelector('#sidebar-wallet-avatar');
    if (sidebarName) sidebarName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
    if (sidebarAddress) sidebarAddress.textContent = connected ? `${appState.connectedWalletAddress.slice(0, 4)}…${appState.connectedWalletAddress.slice(-4)}` : 'Connect to view your portfolio';
    if (sidebarAvatar) sidebarAvatar.textContent = connected ? '✓' : '◎';
    const leaderboardBadge = document.querySelector('#leaderboard-wallet-badge');
    const leaderboardTitle = document.querySelector('#leaderboard-wallet-title');
    const leaderboardLink = document.querySelector('#leaderboard-wallet-link');
    if (leaderboardBadge) leaderboardBadge.textContent = connected ? 'Indexer pending' : 'Wallet required';
    if (leaderboardTitle) leaderboardTitle.textContent = connected ? 'Rank unavailable until activity is indexed' : 'Connect to see your rank';
    if (leaderboardLink) { leaderboardLink.href = connected ? '#docs' : '#profile'; leaderboardLink.textContent = connected ? 'View Solana status →' : 'Connect wallet →'; }
    const profileName = document.querySelector('#profile-wallet-name');
    const profileAddress = document.querySelector('#profile-wallet-address');
    const profileAvatar = document.querySelector('#profile-wallet-avatar');
    const profileConnect = document.querySelector('#profile-connect');
    if (profileName) profileName.textContent = connected ? 'Wallet connected' : 'Wallet not connected';
    if (profileAddress) profileAddress.textContent = connected ? `${appState.connectedWalletAddress.slice(0, 4)}…${appState.connectedWalletAddress.slice(-4)}` : 'Connect to review signing';
    if (profileAvatar) profileAvatar.textContent = connected ? '✓' : '◎';
    if (profileConnect) profileConnect.textContent = connected ? 'View wallet details' : 'Connect wallet';
    appState.renderCreatorLaunches();
    appState.renderPortfolio();
    document.querySelector('#profile-address').textContent = connected ? appState.connectedWalletAddress : 'Not connected';
    const profileCopyAddress = document.querySelector('#profile-copy-address');
    if (profileCopyAddress) {
      profileCopyAddress.disabled = !connected;
      profileCopyAddress.title = connected ? 'Copy wallet address' : 'Connect a wallet before copying its address';
    }
    const profileDisconnect = document.querySelector('#profile-disconnect');
    if (profileDisconnect) profileDisconnect.disabled = !connected;
    document.querySelector('#profile-status').textContent = connected ? appState.wallet.remoteMobile ? 'Phantom mobile wallet connected. Scan a new QR to approve each claim or trade on your phone.' : appState.wallet.readOnly ? 'Address linked for viewing. Open this app inside Phantom to sign transactions.' : appState.wallet.devMode ? 'Local signing wallet connected. The local API signs; private keys do not enter this browser app.' : 'Connected locally. Your wallet remains the signer; private keys do not enter this app.' : 'This profile is local to the demo workspace.';
    const launchPathWallet = document.querySelector('#launch-path-wallet');
    if (launchPathWallet) { launchPathWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect wallet'; launchPathWallet.querySelector('small').textContent = signingReady ? 'Ready for Solana review.' : connected ? 'Review before signing.' : 'Connect to review signing.'; launchPathWallet.classList.toggle('complete', signingReady); }
    const onboardingWallet = document.querySelector('[data-onboarding-step="creator"]');
    if (onboardingWallet) { onboardingWallet.querySelector('strong').textContent = connected ? 'Wallet connected' : 'Connect your wallet'; onboardingWallet.querySelector('small').textContent = signingReady ? 'Ready to review a launch.' : connected ? 'Review before signing.' : 'Connect to unlock your workspace.'; }
    const claimButton = document.querySelector('#sol-claim-submit');
    if (claimButton) claimButton.textContent = connected && typeof appState.wallet.signMessage === 'function' && !appState.wallet.readOnly ? 'Verify linked wallet' : connected ? 'Open in wallet to verify' : 'Connect wallet to verify';
    appState.updateClaimBindingReview();
    const referralActivity = document.querySelector('#referral-activity-list .empty-state');
    if (referralActivity) {
      appState.renderReferralActivityEmpty(connected ? 'Checking referral activity' : 'Activity appears here', connected
        ? 'Loading your private referral dashboard.' : 'Connect your wallet to see qualified referral activity.');
    }
    const tradeQuote = document.querySelector('#trade-quote');
    if (tradeQuote && (!connected || !signingReady || tradeQuote.textContent.startsWith('Connect your wallet'))) tradeQuote.textContent = signingReady ? 'The current quote appears automatically when you enter an amount.' : connected ? 'Open this app inside your wallet to calculate and approve a trade.' : 'Connect a signing wallet to calculate an exact trade quote.';
    const selectedProgram = document.querySelector('[data-program-tier="standard"].active');
    const programNote = document.querySelector('#program-progress-note');
    if (selectedProgram && programNote) programNote.textContent = signingReady ? 'Wallet connected. Review the fee route and launch cost before signing.' : connected ? 'Address linked. Open inside your wallet before signing.' : 'Enter the name and ticker first. Connect only when you are ready to sign.';
    appState.updatePreviewStatusDrawer(connected);
    if (connected) { appState.bindAppReferralToWallet(); void appState.refreshReferralClaims().catch(() => {}); }
    if (!connected) appState.updateReferralStatus('disconnected');
  appState.updateReferralLink();
    appState.updateOnboardingProgress();
    appState.renderAirdropClaims();
    const selectedAirdropCheck = document.querySelector('#airdrop-selected-status [data-check-community-mint]');
    if (selectedAirdropCheck) selectedAirdropCheck.textContent = connected ? 'Check my allocation' : 'Connect wallet to check allocation';
    appState.updateLaunchButton();
    if (connected) { appState.setWalletMetrics({ loading: true }); void appState.refreshWalletBalance(); if (appState.feeRouterState.status !== 'checking') appState.refreshWalletInfo(); }
    else appState.setWalletMetrics();
    appState.renderWalletDetail();
    void appState.loadFundedBurnState({ force: true });
    appState.updateTokenChatComposerState();
    if (appState.currentCoinFeeOverview) appState.renderCoinFeeDashboard(appState.currentCoinFeeOverview);
  }
  // app-source-end

  // app-source: 648
  async function connectWallet(){
    if (appState.APP_MAINNET_READ_ONLY) {
      appState.setLaunchStatus('This workspace is read-only. Wallet connection and signing are disabled.', true);
      appState.showToast('This workspace is read-only. Wallet actions are disabled.');
      return;
    }
    if (!appState.getProvider() && appState.DEV_MODE && appState.DEV_WALLET_AUTOCONNECT) {
      appState.allowWalletReconnect();
      if (await appState.connectDevWallet()) return;
    }
    const choice = await appState.chooseWallet(appState.injectedWalletProviders(), { devnet:appState.APP_CLUSTER === 'devnet', preferred:appState.rememberedWalletProviderId() });
    if (!choice) return;
    if (choice.mobile) { await appState.mobileWallet.open(); return; }
    const provider = choice.provider;
    const request = ++appState.walletConnectRequest;
    try {
      const connected = await appState.connectWalletProvider(provider);
      const connectedAddress = connected.publicKey.toBase58();
      const activatedByEvent = appState.wallet === connected.provider && appState.connectedWalletAddress === connectedAddress;
      if (request !== appState.walletConnectRequest && !activatedByEvent) return;
      appState.allowWalletReconnect();
      appState.activateWallet(connected.provider, 'Wallet connected', { interactiveSignIn: true });
      appState.setLaunchStatus(`Ready to sign with ${connectedAddress}`);
    }
    catch (error) {
      if (request !== appState.walletConnectRequest) return;
      const message = `Connection failed: ${error.message}`;
      appState.showToast('Connection was not completed. Open your wallet and try Connect wallet again.');
      if (!appState.wallet) appState.setWalletState('Connection failed', 'Check your wallet and try again.');
      appState.setLaunchStatus(message, true);
    }
  }
  // app-source-end

  // app-source: 649
  function syncXClaimFlow() {
    return appState.syncXClaimFlowFeature({ captureWalletSession: appState.captureWalletSession });
  }
  // app-source-end

  // app-source: 650
  function updateClaimBindingReview() {
    return appState.updateClaimBindingReviewFeature({ captureWalletSession: appState.captureWalletSession, syncXClaimFlow: appState.syncXClaimFlow });
  }
  // app-source-end

  // app-source: 651
  async function submitSolClaim() {
    return appState.submitSolClaimFeature({ connectWallet: appState.connectWallet, captureWalletSession: appState.captureWalletSession, updateClaimBindingReview: appState.updateClaimBindingReview, assertWalletSessionCurrent: appState.assertWalletSessionCurrent, isWalletSessionCurrent: appState.isWalletSessionCurrent, refreshXClaims: appState.refreshXClaims, showToast: appState.showToast, syncXClaimFlow: appState.syncXClaimFlow, getWallet: () => appState.wallet, emitPilotSignal: appState.emitPilotSignal, apiRequest: appState.apiRequest, pilotInterruptedSignal: appState.pilotInterruptedSignal });
  }
  // app-source-end

  // app-source: 652
  async function disconnectWallet(){
    const provider = appState.wallet;
    appState.markWalletManuallyDisconnected();
    if (provider) appState.disconnectingWalletProviders.add(provider);
    appState.clearWalletState();
    try { await provider?.disconnect?.(); } catch {}
    finally { if (provider) appState.disconnectingWalletProviders.delete(provider); }
  }
  // app-source-end

  // app-source: 653
  function handleAccountChanged(provider, publicKey){
    if (appState.wallet !== provider) return;
    const address = publicKey?.toBase58?.();
    if (!address || address !== appState.walletAddress(provider)) { appState.clearWalletState('Wallet account changed', 'Reconnect your wallet to continue safely.'); return; }
    if (address === appState.connectedWalletAddress) return;
    appState.activateWallet(provider, 'Wallet connected', { interactiveSignIn: true });
    appState.setLaunchStatus(`Wallet changed. Ready to sign with ${address}`);
  }
  // app-source-end

  // app-source: 654
  function reconcileWalletState(){
    if (appState.wallet) {
      if (appState.wallet.isConnected === false || appState.walletAddress(appState.wallet) !== appState.connectedWalletAddress) appState.clearWalletState('Wallet account changed', 'Reconnect your wallet to continue safely.');
      else void appState.refreshWalletBalance();
      return;
    }
    const provider = appState.getProvider();
    if (provider?.isConnected && !appState.wasWalletManuallyDisconnected() && !appState.disconnectingWalletProviders.has(provider) && appState.walletAddress(provider)) appState.activateWallet(provider);
  }
  // app-source-end

  return { setWalletState, connectWallet, syncXClaimFlow, updateClaimBindingReview, submitSolClaim, disconnectWallet, handleAccountChanged, reconcileWalletState };
}
