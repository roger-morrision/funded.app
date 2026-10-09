import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeFeeReadiness(appState) {
  // app-source: 260
  const previewAirdrop = Object.freeze({
    id: 'nova-community-preview',
    name: 'Nova Protocol',
    symbol: 'NOVA',
    allocationPercent: 3,
    reservedTokens: 30_000_000,
    walletAllocation: 12_500,
    status: 'preview-open',
  });
  initializeAppState(appState, 'previewAirdrop', previewAirdrop);
  // app-source-end

  // app-source: 261
  let activeAirdropFilter = 'all';
  initializeAppState(appState, 'activeAirdropFilter', activeAirdropFilter);
  // app-source-end

}
