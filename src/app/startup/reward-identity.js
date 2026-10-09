// Startup runs in the order declared in start.js.
export function initializeRewardIdentity(appState) {
  // app-source: 1007
  document.querySelector('#x-sign-in')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.dataset.connected === 'true') { await appState.apiRequest('/api/x/logout', { method: 'POST' }).catch(() => {}); await appState.loadXIdentity(); return; }
    const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') || window.location.origin;
    window.location.assign(`${apiBase}/api/x/oauth/start`);
  });
  // app-source-end

  // app-source: 1008
  void appState.loadXIdentity();
  // app-source-end

  // app-source: 1009
  appState.updateClaimBindingReview();
  // app-source-end

  // app-source: 1010
  appState.initPaidListing({ getSolana: appState.getSolana, getConnection: () => appState.connection, getSession: appState.captureWalletSession,
    assertSession: appState.assertWalletSessionCurrent, connectWallet: appState.connectWallet, cluster: appState.APP_CLUSTER,
    fundedMint: appState.PROTOCOL_FUNDED_MINT, mainnetReadOnly: appState.APP_MAINNET_READ_ONLY });
  // app-source-end

}
