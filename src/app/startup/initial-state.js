import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeInitialState(appState) {
  // app-source: 129
  globalThis.Buffer ??= appState.Buffer;
  // app-source-end

  // app-source: 130
  const EXPLORE_NETWORK_LABEL = appState.EXPLORE_CLUSTER === 'devnet' ? 'Solana' : appState.EXPLORE_CLUSTER;
  initializeAppState(appState, 'EXPLORE_NETWORK_LABEL', EXPLORE_NETWORK_LABEL);
  // app-source-end

  // app-source: 131
  let solanaModules;
  initializeAppState(appState, 'solanaModules', solanaModules);
  // app-source-end

  // app-source: 132
  let connection;
  initializeAppState(appState, 'connection', connection);
  // app-source-end

  // app-source: 133
  let exploreConnection;
  initializeAppState(appState, 'exploreConnection', exploreConnection);
  // app-source-end

  // app-source: 134
  let tradePreviewConnection;
  initializeAppState(appState, 'tradePreviewConnection', tradePreviewConnection);
  // app-source-end

}
