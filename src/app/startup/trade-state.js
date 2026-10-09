import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeTradeState(appState) {
  // app-source: 546
  const mobileWallet = appState.createMobileWalletController({
    apiRequest: appState.apiRequest, getSolana: appState.getSolana, getWallet: () => appState.wallet, activateWallet: appState.activateWallet,
    allowWalletReconnect: appState.allowWalletReconnect, wasWalletManuallyDisconnected: appState.wasWalletManuallyDisconnected, closeDialog: appState.closeDialog, showToast: appState.showToast,
  });
  initializeAppState(appState, 'mobileWallet', mobileWallet);
  // app-source-end

}
