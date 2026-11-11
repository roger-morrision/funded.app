import { renderIndexedMarket } from './indexed-market.js';
import { formatTinyDecimal } from '../shared/display.js';

// Mainnet token page without per-visitor RPC reads: the server's cached
// overview (DexScreener/Jupiter first, Birdeye fallback) fills the header,
// candles come from the indexed OHLC route and trades are routed by Jupiter.
export async function loadIndexedCoin(appState, mint, loadId, marketRequest) {
  const current = () => loadId === appState.coinLoadId;
  const overviewRequest = appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/overview`, { signal: AbortSignal.timeout(15000) })
    .catch(() => ({ available: false, data: null }));
  // Overview, trades and the SOL quote travel in parallel: one network round trip, not three.
  const tradesRequest = readTrades(appState, mint);
  const solRequest = Number(appState.coinSolUsdPrice) > 0 ? Promise.resolve(Number(appState.coinSolUsdPrice))
    : appState.apiRequest('/api/market/sol-usd', { signal: AbortSignal.timeout(6000) }).then(r => Number(r?.data?.priceUsd) || null).catch(() => null);
  const overview = await overviewRequest;
  if (!current()) return;
  const data = overview.available && overview.data?.mint === mint ? overview.data : null;
  if (!data) {
    appState.renderOnChainUnavailable('Market data for this token is not available yet. Try Refresh in a moment.');
    appState.renderCoinRegistryIdentity?.(mint);
  } else {
    const symbol = data.symbol || `${mint.slice(0, 4)}…`, name = data.name || symbol;
    appState.setCoinField('#coin-page-title', name); appState.setCoinField('#coin-symbol', symbol); appState.setCoinField('#coin-artwork-symbol', symbol);
    appState.setCoinField('#coin-address', appState.shortAddress(mint)); appState.setCoinField('#coin-full-address', mint);
    const avatar = document.querySelector('#coin-avatar');
    if (avatar && typeof data.imageUri === 'string' && data.imageUri.startsWith('https://')) {
      avatar.textContent = ''; avatar.style.backgroundImage = `url("${data.imageUri.replace(/"/g, '%22')}")`;
      avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center'; avatar.removeAttribute('title');
    } else if (avatar) avatar.textContent = symbol.slice(0, 1).toUpperCase();
    const usd = value => Number.isFinite(value) ? appState.formatUsd(value) : '—';
    appState.setCoinField('#coin-price', Number.isFinite(data.priceUsd) ? (data.priceUsd < 0.01 ? `$${formatTinyDecimal(data.priceUsd)}` : usd(data.priceUsd)) : '—');
    for (const selector of ['#coin-market-cap', '#coin-strip-market-cap']) appState.setCoinField(selector, usd(data.marketCapUsd));
    appState.setCoinField('#coin-volume', usd(data.volume24hUsd)); appState.setCoinField('#coin-liquidity', Number.isFinite(data.liquidityUsd) ? usd(data.liquidityUsd) : data.dexId === 'pumpfun' ? 'Bonding curve' : '—');
    appState.setCoinField('#coin-liquidity-label', 'Liquidity');
    appState.setCoinField('#coin-change', Number.isFinite(data.priceChangePercent) ? `${data.priceChangePercent.toFixed(2)}% · 24h` : '24h —');
    appState.setCoinField('#coin-market-cap-label', 'Market cap');
    appState.setCoinField('#coin-market-cap-source', `${data.source === 'birdeye' ? 'Birdeye' : data.source === 'jupiter' ? 'Jupiter' : 'DexScreener'} · indexed market data`);
    appState.setCoinField('#coin-description', data.dexId ? `Trading on ${data.dexId}${data.launchpad ? ` · launched on ${data.launchpad}` : ''}. Swaps route through Jupiter.` : 'Swaps route through Jupiter.');
    appState.setCoinFact?.('#coin-stage', data.dexId ? `Trading · ${data.dexId}` : 'Indexed market', 'clear');
    appState.setCoinFact?.('#coin-fee-owner', 'External token · no Richpad fees', 'clear');
    appState.setCoinFact?.('#coin-metadata-status', data.name ? 'Indexed metadata' : 'Metadata unavailable', data.name ? 'clear' : 'warn');
    for (const [selector, href] of [['#coin-website-link', data.website], ['#coin-x-link', data.twitter], ['#coin-telegram-link', data.telegram], ['#coin-discord-link', data.discord]]) {
      const link = document.querySelector(selector); if (link && typeof href === 'string' && href.startsWith('https://')) { link.href = href; link.hidden = false; }
    }
    appState.compactCoinSocials?.();
    const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = appState.exploreExplorer(`address/${mint}`); explorerLink.hidden = false; }
    const supply = Number.isFinite(data.marketCapUsd) && data.priceUsd > 0 ? data.marketCapUsd / data.priceUsd : null;
    appState.coinIndexedSupply = { mint, supply };
    if (appState.coinActivity) appState.coinActivity.symbol = symbol;
    const chartFooter = document.querySelector('.coin-chart-panel > .chart-footer');
    if (chartFooter) { const span = document.createElement('span'); span.textContent = Number.isFinite(supply) ? `Indexed candles · supply ≈ ${appState.formatOnChainNumber(supply, 0)}` : 'Indexed candles'; chartFooter.replaceChildren(span); }
    const solUsd = await solRequest;
    if (!current()) return;
    appState.coinTradeEstimate = { mint, symbol, curve: null, graduatedPool: null, decimals: Number.isInteger(data.decimals) ? data.decimals : 6, priceUsd: data.priceUsd, solUsd };
    appState.renderTradeAmountEstimate?.();
    appState.updateTradeAmountLabel?.();
    void appState.refreshTradeBalances?.();
    globalThis.window?.dispatchEvent?.(new CustomEvent('funded:coin-facts', { detail: { mint, launch: null, checkedAt: Date.now() } }));
    globalThis.window?.dispatchEvent?.(new CustomEvent('funded:coin-market-facts', { detail: { mint, market: { address: mint, complete: null, migrated: false, source: data.source } } }));
  }
  void appState.loadSolUsdQuote?.();
  appState.renderCoinPricePath?.();
  const [market, trades] = await Promise.all([marketRequest, tradesRequest]);
  if (!current()) return;
  applyTrades(appState, mint, trades, market?.data?.tradeCount24h ?? (data ? data.buyCount24h + data.sellCount24h : null));
  if (market?.available) renderIndexedMarket(appState, market.data, mint);
  if (data) applyNumbers(appState, data);
  startLiveRefresh(appState, mint, loadId);
}

const readTrades = (appState, mint) => appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/trades`, { signal: AbortSignal.timeout(15000) })
  .catch(() => ({ available: false, data: null }));

function applyTrades(appState, mint, trades, tradeCount) {
  const rows = trades?.available && trades.data?.mint === mint && trades.data.available ? trades.data.trades : null;
  // A failed refresh keeps the last good rows instead of blanking the table.
  if (!rows && appState.coinMarketActivity?.indexed && appState.coinMarketActivity.status === 'ready') return;
  appState.coinMarketActivity = rows
    ? { status: 'ready', trades: rows, coverage: 'partial', decimals: trades.data.decimals, graduated: true, tradeCount: Number.isSafeInteger(tradeCount) ? tradeCount : null, indexed: true }
    : { status: 'unavailable', trades: [], coverage: null, decimals: 6, indexed: true };
  appState.renderCoinActivityTab?.(); appState.setCoinTabLabels?.();
}

// Live numbers from a fresh overview; identity fields stay as first rendered.
function applyNumbers(appState, data) {
  const usd = value => Number.isFinite(value) ? appState.formatUsd(value) : '—';
  if (Number.isFinite(data.priceUsd)) appState.setCoinField('#coin-price', data.priceUsd < 0.01 ? `$${formatTinyDecimal(data.priceUsd)}` : usd(data.priceUsd));
  for (const selector of ['#coin-market-cap', '#coin-strip-market-cap']) if (Number.isFinite(data.marketCapUsd)) appState.setCoinField(selector, usd(data.marketCapUsd));
  if (Number.isFinite(data.volume24hUsd)) appState.setCoinField('#coin-volume', usd(data.volume24hUsd));
  appState.setCoinField('#coin-liquidity', Number.isFinite(data.liquidityUsd) ? usd(data.liquidityUsd) : data.dexId === 'pumpfun' ? 'Bonding curve' : '—');
  if (Number.isFinite(data.priceChangePercent)) appState.setCoinField('#coin-change', `${data.priceChangePercent.toFixed(2)}% · 24h`);
  if (appState.coinTradeEstimate?.mint === data.mint && Number.isFinite(data.priceUsd)) { appState.coinTradeEstimate.priceUsd = data.priceUsd; appState.renderTradeAmountEstimate?.(); }
}

// While the tab is visible: price, liquidity and trades every 10 s; the chart
// refetches candles once its short client cache expires.
const LIVE_MS = 10_000;
let liveTimer = null;
function startLiveRefresh(appState, mint, loadId) {
  if (liveTimer) clearTimeout(liveTimer);
  const tick = async () => {
    liveTimer = null;
    if (loadId !== appState.coinLoadId) return;
    if (globalThis.document?.visibilityState !== 'hidden') {
      const [overview, trades] = await Promise.all([
        appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/overview`, { signal: AbortSignal.timeout(8000) }).catch(() => null), readTrades(appState, mint)]);
      if (loadId !== appState.coinLoadId) return;
      const data = overview?.available && overview.data?.mint === mint ? overview.data : null;
      if (data) applyNumbers(appState, data);
      applyTrades(appState, mint, trades, data ? data.buyCount24h + data.sellCount24h : null);
      appState.renderCoinPricePath?.();
    }
    liveTimer = setTimeout(tick, LIVE_MS);
  };
  liveTimer = setTimeout(tick, LIVE_MS);
}
