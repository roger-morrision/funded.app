// Dependencies and mutable application state are read live through appState.
export function createFeeReadinessController(appState) {
  // app-source: 255
  function updateFundedMintConfig(){
    const input = document.querySelector('#funded-mint-address');
    const status = document.querySelector('#funded-mint-status');
    if (!input || !status) return;
    const result = appState.validateSolanaMint(appState.PROTOCOL_FUNDED_MINT);
    if (input.parentElement?.firstChild) input.parentElement.firstChild.textContent = 'Protocol $FUNDED mint';
    input.value = appState.PROTOCOL_FUNDED_MINT;
    input.readOnly = true;
    input.placeholder = 'Set by the protocol deployment';
    if (result.empty) { status.textContent = 'Protocol mint not configured. Paid launch tiers remain disabled.'; status.className = 'field-help'; }
    else if (!result.valid) { status.textContent = 'Deployment configuration contains an invalid mint address.'; status.className = 'field-help funded-mint-invalid'; }
    else { status.textContent = `Protocol mint: ${result.address.slice(0, 6)}…${result.address.slice(-6)}`; status.className = 'field-help funded-mint-valid'; }
    appState.updateLaunchPreview();
  }
  // app-source-end

  // app-source: 256
  function refreshFeeRouterConfig(){
    if (appState.feeRouterRefreshPromise) return appState.feeRouterRefreshPromise;
    appState.feeRouterRefreshPromise = appState.checkFeeRouterConfig().finally(() => { appState.feeRouterRefreshPromise = null; });
    return appState.feeRouterRefreshPromise;
  }
  // app-source-end

  // app-source: 257
  async function checkFeeRouterConfig(){
    const status = document.querySelector('#fee-router-status');
    const addressNode = document.querySelector('#fee-router-address');
    appState.feeRouterState = { status: 'checking', verified: false, address: null, programId: appState.FEE_ROUTER_PROGRAM_ID || null, bump: null };
    if (status) { status.textContent = 'Checking the funded.vip router program…'; status.className = 'field-help'; }
    if (!appState.FEE_ROUTER_PROGRAM_ID) {
      appState.feeRouterState.status = 'program-id-not-configured';
      if (status) { status.textContent = 'Launch blocked: VITE_FUNDED_FEE_ROUTER_PROGRAM_ID is not configured.'; status.className = 'field-help funded-mint-invalid'; }
      if (addressNode) addressNode.textContent = 'Not configured';
      appState.updateLaunchPreview();
      appState.updateLaunchButton();
      return;
    }
    try {
      await appState.getSolana();
      const verified = await appState.withRpcRetry(() => appState.verifyFeeRouterAccount({ connection: appState.connection, programId: appState.FEE_ROUTER_PROGRAM_ID }), { attempts: 2, delaysMs: [700] });
      appState.feeRouterState = { status: verified.reason, verified: verified.verified, address: verified.address.toBase58(), programId: verified.programId.toBase58(), bump: verified.bump };
      if (addressNode) addressNode.textContent = `${appState.feeRouterState.address.slice(0, 6)}…${appState.feeRouterState.address.slice(-6)}`;
      if (status) {
        status.textContent = verified.verified ? 'Verified on Solana. This PDA can be assigned as Pump’s fee owner at creation.' : `Launch blocked: ${verified.reason.replaceAll('-', ' ')}.`;
        status.className = `field-help ${verified.verified ? 'funded-mint-valid' : 'funded-mint-invalid'}`;
      }
    } catch (error) {
      appState.feeRouterState = { status: 'router-verification-unavailable', verified: false, address: null, programId: appState.FEE_ROUTER_PROGRAM_ID, bump: null };
      if (status) { status.textContent = 'Fee-router verification is unavailable. Check your connection before trying again. Signing stays blocked until verification succeeds.'; status.className = 'field-help funded-mint-invalid'; }
      if (addressNode) addressNode.textContent = 'Not verified';
    }
    appState.updateLaunchPreview();
    appState.updateLaunchButton();
    if (appState.wallet) appState.refreshWalletInfo();
  }
  // app-source-end

  // app-source: 258
  async function refreshXFeeStatus(){
    try {
      const result = await appState.apiRequest('/api/x-fee/status', { signal: AbortSignal.timeout(8000) });
      appState.xFeeStatus = result.available && result.data?.ready === true ? result.data : { ready: false, reasons: result.data?.reasons || ['X fee service is unavailable'] };
    } catch (error) { appState.xFeeStatus = { ready: false, reasons: [error.message || 'X fee service is unavailable'] }; }
    const help = document.querySelector('#x-share-help');
    if (help) help.textContent = appState.xFeeStatus.ready ? 'Verified X accounts can claim their share after mint-specific creator fees are collected.' : `Unavailable: ${appState.xFeeFailureDetail()}.`;
    appState.updateLaunchPreview();
    appState.updateLaunchButton();
    if (appState.wallet) appState.scheduleLaunchCostRefresh();
  }
  // app-source-end

  // app-source: 259
  function xFeeFailureDetail(){
    return appState.xFeeStatus.reasons.join('; ').trim().replace(/[.!?]+$/, '') || 'X fee service is unavailable';
  }
  // app-source-end

  return { updateFundedMintConfig, refreshFeeRouterConfig, checkFeeRouterConfig, refreshXFeeStatus, xFeeFailureDetail };
}
