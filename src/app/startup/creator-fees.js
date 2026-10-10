import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeCreatorFees(appState) {
  // app-source: 902
  var currentCoinFeeOverview = null;
  initializeAppState(appState, 'currentCoinFeeOverview', currentCoinFeeOverview);
  // app-source-end

  // app-source: 903
  let coinSummaryLaunch = null;
  initializeAppState(appState, 'coinSummaryLaunch', coinSummaryLaunch);
  // app-source-end

  // app-source: 904
  let coinSummaryLedgerMint = null;
  initializeAppState(appState, 'coinSummaryLedgerMint', coinSummaryLedgerMint);
  // app-source-end

  // app-source: 907
  const creatorClaimsInFlight = new Set();
  initializeAppState(appState, 'creatorClaimsInFlight', creatorClaimsInFlight);
  // app-source-end

  // app-source: 908
  window.addEventListener('funded:creator-claim', event => {
    const { button, mint, overview, complete } = event.detail || {};
    if (!button || !mint) return;
    void appState.requestCreatorFeeClaim(button, mint, overview).finally(() => complete?.());
  });
  // app-source-end

  // app-source: 910
  let coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
  initializeAppState(appState, 'coinMarketActivity', coinMarketActivity);
  // app-source-end

  // app-source: 911
  appState.renderExploreAssets();
  // app-source-end

  // app-source: 913
  let coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN, virtualQuote: NaN, supply: NaN };
  initializeAppState(appState, 'coinSolUsdValues', coinSolUsdValues);
  // app-source-end

  // app-source: 914
  let coinChatMessages = [];
  initializeAppState(appState, 'coinChatMessages', coinChatMessages);
  // app-source-end

  // app-source: 915
  let coinChatState = { loading: true, enabled: false, reason: '' };
  initializeAppState(appState, 'coinChatState', coinChatState);
  // app-source-end

  // app-source: 916
  let coinTradeFilter = 'all';
  initializeAppState(appState, 'coinTradeFilter', coinTradeFilter);
  // app-source-end

  // app-source: 917
  let coinTradeSort = { key: 'date', direction: 'desc' };
  initializeAppState(appState, 'coinTradeSort', coinTradeSort);
  // app-source-end

  // app-source: 918
  let coinTradeOpenFilter = null;
  initializeAppState(appState, 'coinTradeOpenFilter', coinTradeOpenFilter);
  // app-source-end

  // app-source: 919
  let coinChartMetric = 'mcap';
  initializeAppState(appState, 'coinChartMetric', coinChartMetric);
  // app-source-end

  // app-source: 920
  let coinChartUnit = 'usd';
  initializeAppState(appState, 'coinChartUnit', coinChartUnit);
  // app-source-end

  // app-source: 921
  let coinChartPeriod = '24h';
  initializeAppState(appState, 'coinChartPeriod', coinChartPeriod);
  // app-source-end

  // app-source: 922
  let coinPulsePeriod = '24h';
  initializeAppState(appState, 'coinPulsePeriod', coinPulsePeriod);
  // app-source-end

  // app-source: 923
  let coinLoadId = 0;
  initializeAppState(appState, 'coinLoadId', coinLoadId);
  // app-source-end

}
