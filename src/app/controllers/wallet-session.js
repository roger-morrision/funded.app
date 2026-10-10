// Dependencies and mutable application state are read live through appState.
export function createWalletSessionController(appState) {
  // app-source: 575
  function openInfoDialog(kind, { routeDriven = false } = {}){
    const content = {
      terms: ['Terms of Use', '<div class="legal-meta"><span>Effective 18 Sep 2026</span><span>Version 1.0</span><span>Applies to funded.vip</span></div><p>You are responsible for reviewing every transaction before signing and for complying with applicable rules.</p><h3>Contents</h3><ul class="legal-list"><li>Wallet connection and signatures</li><li>Token metadata and deployer responsibility</li><li>Network, fees, and transaction confirmation</li><li>Prohibited use and service limitations</li><li>Privacy, disclosures, and support</li></ul><p class="muted-note">This is product information, not legal advice.</p>'],
      disclosures: ['Disclosures', '<div class="legal-meta"><span>Effective 7 Oct 2026</span><span>Version 1.6</span><span>Applies to funded.vip</span></div><p>The Pump launch flow creates the coin with the verified funded.vip router PDA written directly into Pump’s creator field. The paying wallet never receives creator-fee authority, and the app reads the bonding curve back before reporting success.</p><h3>Important limits</h3><ul class="legal-list"><li>The app indexes finalized receipts. Automatic creator and holder SOL delivery requires verified funding and an active healthy distribution worker; holder payouts also require complete finalized indexing. Check the live status on Home before relying on delivery. Referral rewards remain wallet-initiated claims.</li><li>X fee claims require verified X identity and a matching on-chain obligation. Community-token claims require a funded reserve, a verified migration snapshot, and an active claim window; availability varies by coin.</li><li>Pump protocol administrators or a future Pump program upgrade remain outside funded.vip’s control.</li><li>funded.vip is not affiliated with X, Phantom, or Pump.fun.</li></ul><p class="muted-note">Verify the Pump creator address in the launch transaction and bonding-curve account on Solana Explorer.</p>'],
      capital: ['Capital flow', '<p>This calculator illustrates the published allocation policy. Confirmed launch, collection, and payout records appear in the verified workspace pages when the receipt indexer has recorded them.</p>'],
    'opt-out': ['Opt out', '<div class="legal-meta"><span>Account controls</span><span>Verified X identity</span></div><p>Sign in with the X account named in a launch policy, then exclude its creator page and block new support launches.</p><div class="optout-steps"><div><b>1</b><span><strong>Sign in with X</strong><small>Verify control of the account you want to manage.</small></span></div><div><b>2</b><span><strong>Choose exclusion</strong><small>Select “Exclude my page and block new support launches” in creator settings, then save.</small></span></div><div><b>3</b><span><strong>Review status</strong><small>Reopen creator settings to confirm the saved choice and update time. Existing finalized receipts and entitlements remain on record.</small></span></div></div><button type="button" class="secondary-button info-action" data-open-creator-settings>Manage X account controls</button>'],
    }[kind] || ['Information', '<p>Explore the funded.vip workspace and review each transaction before signing.</p>'];
    document.querySelector('#info-title').textContent = content[0];
    document.querySelector('#info-content').innerHTML = content[1];
    document.querySelector('#info-content [data-open-creator-settings]')?.addEventListener('click', () => {
      appState.closeInfoDialog();
      location.hash = 'creator-settings';
    });
    const dialog = document.querySelector('#info-dialog');
    dialog.dataset.infoKind = kind;
    dialog.dataset.routeDriven = routeDriven ? 'true' : 'false';
    if (!dialog.open) dialog.showModal();
  }
  // app-source-end

  // app-source: 576
  function closeInfoDialog(){
    const dialog = document.querySelector('#info-dialog');
    const routeDriven = dialog.dataset.routeDriven === 'true';
    dialog.close();
    delete dialog.dataset.infoKind;
    delete dialog.dataset.routeDriven;
    const hash = location.hash.replace(/^#/, '');
    if (routeDriven && appState.infoDialogRoutes.has(hash)) {
      history.replaceState({}, '', `${location.pathname}${location.search}#overview`);
      appState.syncPageRoute();
    }
  }
  // app-source-end

  // app-source: 577
  function openFilterDialog(button){
    const label = button.textContent.replace('⌄', '').trim();
    const choices = {
      'Market cap': ['Any market cap', 'Under $1M', '$1M–$10M', 'Over $10M'],
      'Flow direction': ['All flow', 'Funds in', 'Funds out', 'New positions'],
    }[label] || ['All'];
    document.querySelector('#filter-title').textContent = label;
    const options = document.querySelector('#filter-options');
    options.replaceChildren(...choices.map(choice => { const item = document.createElement('button'); item.type = 'button'; item.textContent = choice; item.addEventListener('click', () => { button.childNodes[0].textContent = `${choice} `; document.querySelector('#filter-dialog').close(); appState.showToast(`${choice} filter selected`); }); return item; }));
    document.querySelector('#filter-dialog').showModal();
  }
  // app-source-end

  // app-source: 578
  function closeDialog(id){
    const dialog = document.querySelector(`#${id}`);
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
  }
  // app-source-end

  // app-source: 579
  function injectedWalletProviders(){
    return [
      { id: 'phantom', provider: window.phantom?.solana },
      { id: 'backpack', provider: window.backpack?.solana },
      { id: 'solflare', provider: window.solflare },
      { id: 'legacy', provider: window.solana },
    ].filter(entry => entry.provider);
  }
  // app-source-end

  // app-source: 580
  function readWalletPreference(key){
    try { const value = localStorage.getItem(key); if (value !== null) return value; } catch {}
    try { return sessionStorage.getItem(key); } catch { return null; }
  }
  // app-source-end

  // app-source: 581
  function saveWalletPreference(key, value){
    try { localStorage.setItem(key, value); } catch {}
    try { sessionStorage.setItem(key, value); } catch {}
  }
  // app-source-end

  // app-source: 582
  function removeWalletPreference(key){
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }
  // app-source-end

  // app-source: 583
  function rememberedWalletProviderId(){
    return appState.readWalletPreference(appState.WALLET_PROVIDER_KEY);
  }
  // app-source-end

  // app-source: 584
  function getProvider(){
    return appState.selectRememberedWalletProvider(appState.injectedWalletProviders(), appState.rememberedWalletProviderId());
  }
  // app-source-end

  // app-source: 585
  function phantomProvider(){
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    return window.solana?.isPhantom ? window.solana : null;
  }
  // app-source-end

  // app-source: 586
  async function waitForPhantomProvider(){
    const provider = appState.phantomProvider();
    if (provider) return provider;
    return new Promise(resolve => {
      const check = () => { const injected = appState.phantomProvider(); if (injected) finish(injected); };
      const finish = injected => { clearInterval(interval); clearTimeout(timeout); resolve(injected); };
      const interval = setInterval(check, 100);
      const timeout = setTimeout(() => finish(null), 3000);
    });
  }
  // app-source-end

  // app-source: 587
  async function restoreTrustedPhantomWallet(){
    const remembered = appState.rememberedWalletProviderId();
    if ((remembered && remembered !== 'phantom' && remembered !== 'legacy') || appState.wasWalletManuallyDisconnected() || appState.wallet) return false;
    const provider = await appState.waitForPhantomProvider();
    if (!provider || (remembered === 'legacy' && window.solana !== provider) || appState.wasWalletManuallyDisconnected() || appState.wallet) return false;
    appState.observeWalletProvider(provider);
    const request = ++appState.walletConnectRequest;
    let timeout;
    try {
      const connected = await Promise.race([
        appState.connectWalletProvider(provider, { onlyIfTrusted: true }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Trusted wallet reconnection timed out.')), 3000); }),
      ]);
      if (request !== appState.walletConnectRequest || appState.wasWalletManuallyDisconnected() || appState.wallet) return false;
      appState.activateWallet(connected.provider);
      return true;
    } catch { return false; }
    finally { clearTimeout(timeout); }
  }
  // app-source-end

  // app-source: 588
  function captureWalletSession(){
    return appState.wallet && appState.connectedWalletAddress ? { provider: appState.wallet, address: appState.connectedWalletAddress, version: appState.walletVersion } : null;
  }
  // app-source-end

  // app-source: 589
  function isWalletSessionCurrent(session){
    return Boolean(session && appState.wallet === session.provider && appState.walletVersion === session.version
      && appState.wallet.isConnected !== false && appState.connectedWalletAddress === session.address && appState.walletAddress(appState.wallet) === session.address);
  }
  // app-source-end

  // app-source: 590
  function wasWalletManuallyDisconnected(){
    return appState.walletDisconnectRequested || appState.readWalletPreference(appState.WALLET_MANUAL_DISCONNECT_KEY) === '1';
  }
  // app-source-end

  // app-source: 591
  function markWalletManuallyDisconnected(){
    appState.walletDisconnectRequested = true;
    appState.saveWalletPreference(appState.WALLET_MANUAL_DISCONNECT_KEY, '1');
  }
  // app-source-end

  // app-source: 592
  function allowWalletReconnect(){
    appState.walletDisconnectRequested = false;
    appState.removeWalletPreference(appState.WALLET_MANUAL_DISCONNECT_KEY);
  }
  // app-source-end

  // app-source: 593
  function assertWalletSessionCurrent(session){
    if (!appState.isWalletSessionCurrent(session)) throw new Error('Wallet account changed. Review and retry with the connected account.');
  }
  // app-source-end

  // app-source: 594
  function resetWalletDependentViews(){
    appState.walletSignIn.clear();
    appState.communityWalletAllocations.clear();
    appState.communityClaimReview = null;
    const previousChatToken = appState.coinChatSession?.token;
    appState.coinChatSession = null;
    appState.coinChatSessionPromise = null;
    if (previousChatToken) {
      try { sessionStorage.removeItem(appState.COIN_CHAT_SESSION_KEY); } catch {}
      void appState.apiRequest('/api/token-chat/session/revoke', { method: 'POST', headers: { 'x-token-chat-session': previousChatToken } }).catch(() => {});
    }
    appState.metricsRequest++;
    appState.fundedBurnRequest++;
    appState.fundedBurnState = { status: 'idle', wallet: null, decimals: 0, balanceBaseUnits: 0n, supplyBaseUnits: 0n, burnedBaseUnits: 0n, tokenAccounts: [], receipts: [], message: 'Connect a wallet to load its Solana balance.' };
    appState.renderWalletFundedBalance();
    clearTimeout(appState.launchCostRefreshTimer);
    appState.launchCostRefreshTimer = null;
    appState.launchEstimateRetry = null;
    appState.walletBalanceLamports = null;
    appState.walletBalanceRequest++;
    appState.walletBalanceFetchedAt = 0;
    appState.estimatedLaunchFeeLamports = null;
    appState.resetTradeBalances();
    appState.invalidateTradePreview();
    appState.fundedBuyPreview = null;
    if (!appState.boostCheckout.pendingSignature) appState.boostCheckout.quote = null;
    appState.launchCostReview = null;
    document.querySelector('#launch-review-dialog')?.close();
    for (const id of ['fee-route-agree', 'terms-agree']) { const input = document.getElementById(id); if (input) input.checked = false; }
    appState.renderReferralClaimPrompt();
    for (const id of ['referral-active-creators', 'referral-conversion-rate']) {
      const node = document.querySelector(`#${id}`); if (node) node.textContent = '—';
    }
    for (const id of ['referral-total-claimable', 'referral-paid-total']) {
      const node = document.querySelector(`#${id}`); if (node) node.textContent = '— SOL';
    }
    const ledger = document.querySelector('#referral-ledger-list');
    if (ledger) appState.renderReferralLedgerEmpty('No receipts to show', 'Connect your wallet to check finalized referral claims.');
    const claimStatus = document.querySelector('#sol-claim-status');
    if (claimStatus) claimStatus.textContent = '';
  }
  // app-source-end

  // app-source: 595
  function observeWalletProvider(provider){
    if (!provider?.on || appState.observedWalletProviders.has(provider)) return;
    appState.observedWalletProviders.add(provider);
    provider.on('connect', () => { if (!appState.wallet && !appState.wasWalletManuallyDisconnected() && provider.isConnected && appState.walletAddress(provider)) appState.activateWallet(provider); });
    provider.on('disconnect', () => { if (appState.wallet === provider) { appState.markWalletManuallyDisconnected(); appState.clearWalletState(); } });
    provider.on('accountChanged', publicKey => appState.handleAccountChanged(provider, publicKey));
    const networkChanged = () => {
      if (appState.wallet !== provider) return;
      appState.walletVersion++;
      appState.resetWalletDependentViews();
      appState.setLaunchStatus('Wallet network changed. Verify the app network and refresh the estimate before signing.');
      void appState.refreshWalletInfo().catch(() => {});
    };
    provider.on('chainChanged', networkChanged);
    provider.on('networkChanged', networkChanged);
  }
  // app-source-end

  // app-source: 596
  function activateWallet(provider, message = 'Wallet connected', { interactiveSignIn = false } = {}){
    if (appState.APP_MAINNET_READ_ONLY) return;
    const address = appState.walletAddress(provider);
    if (!address) throw new Error('Wallet did not provide an account address.');
    const signIn = () => {
      const session = appState.captureWalletSession();
      void appState.ensureReferralSession(session, { interactive: true })
        .then(() => { if (appState.isWalletSessionCurrent(session)) void appState.refreshReferralClaims(); })
        .catch(error => { if (appState.isWalletSessionCurrent(session)) appState.showToast(error?.code === 4001 ? 'Sign-in cancelled. Your wallet remains connected.' : error.message || 'Wallet sign-in is unavailable.'); });
    };
    if (appState.wallet === provider && appState.connectedWalletAddress === address) { if (interactiveSignIn) signIn(); return; }
    if (appState.connectedWalletAddress && appState.connectedWalletAddress !== address) void appState.walletSignIn.logout().catch(() => {});
    appState.walletConnectRequest++;
    appState.walletVersion++;
    appState.resetWalletDependentViews();
    appState.wallet = provider;
    appState.connectedWalletAddress = address;
    appState.restoreCoinChatSession(address);
    const providerId = appState.injectedWalletProviders().find(entry => entry.provider === provider)?.id;
    if (providerId) appState.saveWalletPreference(appState.WALLET_PROVIDER_KEY, providerId);
    appState.observeWalletProvider(provider);
    appState.setWalletState(message, address, true);
    if (interactiveSignIn) signIn();
    if (appState.watchlistSync.identity()?.startsWith('wallet:')) void appState.watchlistSync.setIdentity(null);
    void appState.restoreWalletFavorites();
    void appState.refreshPortfolioHoldings();
    void appState.refreshTradeBalances();
    appState.queueTradeQuote();
  }
  // app-source-end

  // app-source: 597
  function clearWalletState(message = 'Wallet not connected', detail = 'Connect a wallet to continue'){
    appState.walletConnectRequest++;
    appState.walletVersion++;
    appState.resetWalletDependentViews();
    try { sessionStorage.removeItem(appState.COIN_CHAT_SESSION_KEY); } catch {}
    appState.wallet = null;
    appState.connectedWalletAddress = null;
    void appState.walletSignIn.logout().catch(() => {});
    appState.launchTierQuote = null;
    void appState.refreshPortfolioHoldings();
    appState.renderTradeBalances();
    appState.setWalletState(message, detail);
    if (appState.watchlistSync.identity()?.startsWith('wallet:')) void appState.loadXIdentity();
    appState.setLaunchStatus('');
  }
  // app-source-end

  // app-source: 598
  function normalizePreviewLabels(){
    const replacements = new Map([
      ['Solana only', 'Preview route'],
      ['Solana claims', 'Claims'],
      ['Open Solana trading ↗', 'Open trading ↗'],
      ['Get 1 SOL', 'Open faucet'],
    ]);
    document.querySelectorAll('button, .panel-count, .data-badge, .eyebrow').forEach(node => {
      const replacement = replacements.get(node.textContent.trim());
      if (replacement) node.textContent = replacement;
    });
  }
  // app-source-end

  // app-source: 599
  function bytesToBase64(bytes){ let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
  // app-source-end

  // app-source: 600
  function base64ToBytes(value){ const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
  // app-source-end

  // app-source: 601
  async function connectDevWallet(){
    const injectedProvider = appState.getProvider();
    if (!appState.DEV_MODE || !appState.DEV_WALLET_AUTOCONNECT || appState.wasWalletManuallyDisconnected() || (injectedProvider?.isConnected && injectedProvider.publicKey)) return false;
    try {
      const result = await appState.apiRequest('/api/dev-wallet');
      const { PublicKey, Transaction, VersionedTransaction } = await appState.getSolana();
      const publicKey = new PublicKey(result.data.publicKey);
      const devProvider = {
        devMode: true,
        publicKey,
        isConnected: true,
        signTransaction: async transaction => {
          const signed = await appState.apiRequest('/api/dev-wallet/sign-transaction', { method: 'POST', body: { transaction: appState.bytesToBase64(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })) } });
          return transaction instanceof VersionedTransaction
            ? VersionedTransaction.deserialize(appState.base64ToBytes(signed.data.transaction))
            : Transaction.from(appState.base64ToBytes(signed.data.transaction));
        },
        signMessage: async message => {
          const signed = await appState.apiRequest('/api/dev-wallet/sign-message', { method: 'POST', body: { message: appState.bytesToBase64(message) } });
          return appState.base64ToBytes(signed.data.signature);
        },
        disconnect: async () => {},
      };
      appState.activateWallet(devProvider, 'Wallet connected');
      appState.setLaunchStatus(`Wallet ready: ${appState.DEV_WALLET_ROLE}`);
      return true;
    } catch { return false; }
  }
  // app-source-end

  return { openInfoDialog, closeInfoDialog, openFilterDialog, closeDialog, injectedWalletProviders, readWalletPreference, saveWalletPreference, removeWalletPreference, rememberedWalletProviderId, getProvider, phantomProvider, waitForPhantomProvider, restoreTrustedPhantomWallet, captureWalletSession, isWalletSessionCurrent, wasWalletManuallyDisconnected, markWalletManuallyDisconnected, allowWalletReconnect, assertWalletSessionCurrent, resetWalletDependentViews, observeWalletProvider, activateWallet, clearWalletState, normalizePreviewLabels, bytesToBase64, base64ToBytes, connectDevWallet };
}
