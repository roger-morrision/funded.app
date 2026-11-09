import { ensureLaunchAvailability, updateLaunchAvailabilityView } from '../../features/launch/availability-view.js';

// Dependencies and mutable application state are read live through appState.
export function createFeeReadinessController(appState) {
  ensureLaunchAvailability();
  function updateLaunchAvailability() { updateLaunchAvailabilityView(appState); }
  globalThis.window?.addEventListener?.('funded:launch-step', updateLaunchAvailability);
  // app-source: 255
  function updateFundedMintConfig(){
    const input = document.querySelector('#funded-mint-address');
    const status = document.querySelector('#funded-mint-status');
    if (!input || !status) return;
    const result = appState.validateSolanaMint(appState.PROTOCOL_FUNDED_MINT);
    if (input.parentElement?.firstChild) input.parentElement.firstChild.textContent = 'Protocol $RICH mint';
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
    ensureLaunchAvailability();
    const status = document.querySelector('#fee-router-status');
    const addressNode = document.querySelector('#fee-router-address');
    appState.feeRouterState = { status:'checking', verified:false, address:null,
      programId:null, scope:'per-mint-v3', v3FeeRouter:null };
    if (status) { status.textContent = 'Checking launch availability…'; status.className = 'field-help'; }
    updateLaunchAvailability();
    try {
      const service = await appState.apiRequest('/api/v3-launch-config');
      const config = service.available ? service.data : null;
      if (config?.ready !== true || config.cluster !== 'devnet'
        || !config.programId || !config.initialAuthority || !config.protocolSplit) {
        throw new Error(config?.reasons?.join('; ') || 'Launch service is unavailable');
      }
      await appState.getSolana();
      const verified = await appState.withRpcRetry(() => appState.verifyFeeRouterAccount({
        connection:appState.connection, programId:config.programId, commitment:'finalized',
      }), { attempts:2, delaysMs:[700] });
      if (!verified.verified || verified.authority.toBase58() !== config.initialAuthority) {
        throw new Error('V3 program authority differs from the verified Devnet configuration');
      }
      appState.feeRouterState = { status:'verified', verified:true,
        address:verified.address.toBase58(), programId:config.programId,
        scope:'per-mint-v3', v3FeeRouter:{ programId:config.programId,
          initialAuthority:config.initialAuthority, split:config.protocolSplit,...(config.agency?{agency:config.agency}:{}) } };
      window.dispatchEvent(new CustomEvent('funded:agency-readiness',{detail:{active:Boolean(config.agency)}}));
      if (addressNode) addressNode.textContent = 'Derived for each new mint';
      if (status) { status.textContent = 'Launch checks passed.';
        status.className = 'field-help funded-mint-valid'; }
    } catch (error) {
      appState.feeRouterState = { status:String(error?.message || 'V3 launch verification unavailable'),
        verified:false, address:null, programId:null, scope:'per-mint-v3', v3FeeRouter:null };
      window.dispatchEvent(new CustomEvent('funded:agency-readiness',{detail:{active:false}}));
      if (status) { status.textContent = 'Launch checks are unavailable. Retry checks to continue.';
        status.className = 'field-help funded-mint-invalid'; }
      if (addressNode) addressNode.textContent = 'Not verified';
    }
    updateLaunchAvailability();
    appState.updateLaunchPreview();
    appState.updateLaunchButton();
    if (appState.wallet) appState.refreshWalletInfo();
  }
  // app-source-end

  return { updateFundedMintConfig, refreshFeeRouterConfig, checkFeeRouterConfig };
}
