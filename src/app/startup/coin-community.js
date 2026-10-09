import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeCoinCommunity(appState) {
  // app-source: 973
  const COIN_TRADE_COLUMNS = [
    ['date', 'Date'], ['type', 'Type'], ['usd', 'USD est.'], ['token', 'Token'],
    ['sol', 'SOL'], ['price', 'Price est.'], ['trader', 'Trader'], ['txn', 'Txn'],
  ];
  initializeAppState(appState, 'COIN_TRADE_COLUMNS', COIN_TRADE_COLUMNS);
  // app-source-end

}
