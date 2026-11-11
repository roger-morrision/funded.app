import { INDEXED_FRAMES } from '../../features/coin/chart-data.js';
import { linkWalletText } from '../../features/shared/wallet-links.js';
import { formatTinyDecimal } from '../../features/shared/display.js';
import { renderHeaderActivity } from '../../features/coin/header-activity.js';

// Dependencies and mutable application state are read live through appState.
export function createCoinMarketController(appState) {
  // app-source: 948
  function formatCoinUsd(solValue){
    if (solValue == null) return '$—';
    const sol = Number(solValue);
    if (!Number.isFinite(sol)) return '$—';
    const usd = Number.isFinite(sol) && Number.isFinite(appState.coinSolUsdPrice) ? sol * appState.coinSolUsdPrice : NaN;
    return Number.isFinite(usd) && appState.coinSolUsdPrice > 0 && sol >= 0 ? appState.formatUsd(usd) : '$—';
  }
  // app-source-end

  // app-source: 949
  function formatCoinSnapshotUsd(solValue){
    if (solValue == null || !Number.isFinite(Number(solValue)) || !Number.isFinite(appState.coinSolUsdPrice) || appState.coinSolUsdPrice <= 0) return '$—';
    const usd = Number(solValue) * appState.coinSolUsdPrice;
    if (!Number.isFinite(usd) || usd < 0) return '$—';
    if (usd > 0 && usd < 0.0001) return usd < 1e-14 ? `$${usd.toExponential(4)}` : `$${formatTinyDecimal(usd)}`;
    return appState.formatUsd(usd);
  }
  // app-source-end

  // app-source: 950
  function formatExploreUsd(value, options = {}){
    const prefix = options.partial ? '≥' : '';
    return `${prefix}${appState.formatCoinUsd(value)}`;
  }
  // app-source-end

  // app-source: 951
  async function loadSolUsdQuote(quoteResponse = null){
    const response = await (quoteResponse || appState.apiRequest('/api/market/sol-usd')).catch(() => ({ available: false, data: null }));
    const quote = Number(response.data?.priceUsd);
    if (!response.available || !Number.isFinite(quote) || quote <= 0) return;
    appState.coinSolUsdPrice = quote;
    document.dispatchEvent(new Event('funded:rankings-updated'));
    appState.publishTokenListMarkets(appState.assets, appState.EXPLORE_CLUSTER, appState.coinSolUsdPrice);
    appState.renderFundedTokenLanding();
    if (appState.coinMarketActivity?.indexed) return;
    appState.setCoinField('#coin-market-cap', appState.formatCoinUsd(appState.coinSolUsdValues.marketCap));
    appState.setCoinField('#coin-strip-market-cap', appState.formatCoinUsd(appState.coinSolUsdValues.marketCap));
    appState.setCoinField('#coin-price', appState.formatCoinSnapshotUsd(appState.coinSolUsdValues.spot));
    appState.setCoinField('#coin-liquidity', appState.formatCoinSnapshotUsd(appState.coinSolUsdValues.spot));
    appState.renderCoinSummary();
    if (appState.coinMarketActivity.graduated && appState.coinMarketActivity.status === 'unavailable') appState.setCoinField('#coin-volume', 'Pool activity unavailable');
    else if (appState.coinMarketActivity.coverage === 'complete' && appState.coinMarketActivity.tradeCount === 0) appState.setCoinField('#coin-volume', 'No trades');
    else if (Number.isFinite(Number(appState.coinMarketActivity.volume24hSol))) appState.setCoinField('#coin-volume', `${appState.formatExploreUsd(appState.coinMarketActivity.volume24hSol, { partial: appState.coinMarketActivity.coverage === 'partial' })}${appState.coinMarketActivity.coverage === 'partial' ? ' · partial' : ''}`);
    appState.renderCoinPricePath(); appState.renderCoinPulse(); appState.renderCoinActivityTab();
    appState.renderExploreAssets(); appState.renderRegistry(); appState.renderHomeLaunchBoard(); appState.renderHomeKpiDashboard(appState.assets); appState.renderOnchainReportState(appState.assets);
    if (document.querySelector('#wallet-page:not([hidden])')) appState.renderWalletDetail();
  }
  // app-source-end

  // app-source: 953
  function readMetadataString(data, offset){
    if (offset + 4 > data.length) return { value: '', offset: data.length };
    const length = data.readUInt32LE(offset); const start = offset + 4; const end = Math.min(start + length, data.length);
    return { value: data.subarray(start, end).toString('utf8').replace(/\0/g, '').trim(), offset: start + length };
  }
  // app-source-end

  // app-source: 954
  function parseOnChainMetadata(data){
    if (!data || data.length < 1 + 32 + 32 + 4) return {};
    let offset = 1 + 32 + 32;
    const name = appState.readMetadataString(data, offset); offset = name.offset;
    const symbol = appState.readMetadataString(data, offset);
    return { name: name.value, symbol: symbol.value };
  }
  // app-source-end

  // app-source: 955
  function setCoinCurveProgress(progress){
    const value = Number(progress);
    const valid = progress != null && Number.isFinite(value);
    appState.setCoinField('#coin-curve-progress', valid ? `${appState.formatOnChainNumber(value, 2)}%` : 'Unavailable');
    const fill = document.querySelector('#coin-curve-fill');
    if (fill) fill.style.width = `${valid ? Math.max(0, Math.min(100, value)) : 0}%`;
    // The header ring reads the same value as a CSS variable.
    document.querySelector('.coin-curve-track')?.style.setProperty('--curve-progress', String(valid ? Math.max(0, Math.min(100, value)) : 0));
  }
  // app-source-end

  // Mainnet candles come from the server's indexed OHLC route (free GeckoTerminal first).
  const candleCache = new Map(), candleLoading = new Set();
  function indexedCandles() {
    const mint = appState.getCoinMintAddress(), frame = INDEXED_FRAMES[appState.coinChartPeriod] || '15m', key = `${mint}:${frame}`;
    const supply = appState.coinIndexedSupply?.mint === mint ? appState.coinIndexedSupply.supply : null;
    const hit = candleCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return { ...hit.data, mint, supply, status: 'ready' };
    if (mint && !candleLoading.has(key)) {
      candleLoading.add(key);
      appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/ohlcv?frame=${frame}`, { signal: AbortSignal.timeout(15000) })
        .then(result => candleCache.set(key, { at: Date.now(), data: { candles: result.available && result.data?.mint === mint ? result.data.candles || [] : [], source: result.data?.source || null } }))
        .catch(() => candleCache.set(key, { at: Date.now(), data: { candles: [], source: null } })).finally(() => { candleLoading.delete(key); if (appState.getCoinMintAddress() === mint) renderCoinPricePath(); });
    }
    return hit ? { ...hit.data, mint, supply, status: 'ready' } : { mint, candles: [], supply, status: candleLoading.has(key) ? 'loading' : 'ready' };
  }
  // app-source: 956
  function renderCoinPricePath(){
    const coinIndexedCandles = appState.EXPLORE_CLUSTER === 'mainnet-beta' ? indexedCandles() : null;
    return appState.renderCoinPricePathView({ coinIndexedCandles, coinChartPeriod: appState.coinChartPeriod, coinChartMetric: appState.coinChartMetric, coinChartUnit: appState.coinChartUnit, coinMarketActivity: appState.coinMarketActivity, coinSolUsdValues: appState.coinSolUsdValues, coinSolUsdPrice: appState.coinSolUsdPrice, coinMint: appState.getCoinMintAddress() }, { formatCoinSnapshotUsd: appState.formatCoinSnapshotUsd });
  }
  // app-source-end

  // app-source: 957
  function renderCoinFlow(buy, sell, partial = false){
    const buyBar = document.querySelector('#coin-flow-buy');
    const sellBar = document.querySelector('#coin-flow-sell');
    const note = document.querySelector('#coin-flow .coin-flow-heading small');
    appState.setCoinField('#coin-flow .coin-flow-heading > span', appState.coinMarketActivity.graduated ? 'Observed 24h curve + pool volume' : 'Observed 24h curve volume');
    const valid = Number.isFinite(buy) && Number.isFinite(sell) && buy >= 0 && sell >= 0;
    const total = valid ? buy + sell : 0;
    if (buyBar) buyBar.style.width = `${total ? buy / total * 100 : 0}%`;
    if (sellBar) sellBar.style.width = `${total ? sell / total * 100 : 0}%`;
    appState.setCoinField('#coin-flow-buy-label', valid ? `Buy ${appState.formatExploreUsd(buy, { partial })}` : 'Buy —');
    appState.setCoinField('#coin-flow-sell-label', valid ? `Sell ${appState.formatExploreUsd(sell, { partial })}` : 'Sell —');
    if (note) note.textContent = valid ? total ? `${partial ? 'Partial' : 'Confirmed'} ${appState.coinMarketActivity.graduated ? 'curve and pool' : 'curve'} trade scan` : 'No observed trade volume' : 'Buy/sell volume unavailable';
  }
  // app-source-end

  // app-source: 958
  function renderCoinPulse(){
    renderHeaderActivity(appState.coinMarketActivity);
    return appState.renderCoinPulseView({ coinMarketActivity: appState.coinMarketActivity, coinPulsePeriod: appState.coinPulsePeriod }, { formatExploreUsd: appState.formatExploreUsd });
  }
  // app-source-end

  // app-source: 959
  function coinAuthorityLabel(value){ return value === null ? 'Disabled' : value ? appState.shortAddress(value) : 'Unavailable'; }
  // app-source-end

  // app-source: 960
  function setCoinAuthority(selector, value){ appState.setCoinFact(selector, appState.coinAuthorityLabel(value), value === null ? 'clear' : value ? 'caution' : 'unknown'); linkWalletText(document.querySelector(selector), value); }
  // app-source-end

  // app-source: 961
  function setCoinTabLabels(){
    const labels = {
      trades: `Trades ${['ready', 'summary-only'].includes(appState.coinMarketActivity.status) ? appState.coinMarketActivity.tradeCount : '—'}`,
      chat: 'Chat',
      rewards: 'My rewards',
      payments: `Fee collections ${appState.coinActivity.status === 'ready' && appState.coinActivity.ledgerAvailable ? appState.coinActivity.collections.length : '—'}`,
      claims: `Allocations ${appState.coinActivity.status === 'ready' && appState.coinActivity.ledgerAvailable ? appState.coinActivity.claims.length : '—'}`,
      holders: `Holders ${appState.coinActivity.holderDistribution ? appState.coinActivity.holderCount : '—'}`,
    };
    document.querySelectorAll('[data-coin-tab]').forEach(item => {
      item.textContent = labels[item.dataset.coinTab] || item.textContent;
      item.setAttribute('aria-selected', String(item.classList.contains('active')));
      item.tabIndex = item.classList.contains('active') ? 0 : -1;
    });
  }
  // app-source-end

  return { formatCoinUsd, formatCoinSnapshotUsd, formatExploreUsd, loadSolUsdQuote, readMetadataString, parseOnChainMetadata, setCoinCurveProgress, renderCoinPricePath, renderCoinFlow, renderCoinPulse, coinAuthorityLabel, setCoinAuthority, setCoinTabLabels };
}
