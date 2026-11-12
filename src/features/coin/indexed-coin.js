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
  void loadHolders(appState, mint, loadId, data);
  const [market, trades] = await Promise.all([marketRequest, tradesRequest]);
  if (!current()) return;
  appState.coinIndexedWindows = { mint, windows: data?.windows || null, solUsd: Number(appState.coinTradeEstimate?.solUsd) || null };
  applyTrades(appState, mint, trades, market?.data?.tradeCount24h ?? (data ? data.buyCount24h + data.sellCount24h : null));
  if (market?.available) renderIndexedMarket(appState, market.data, mint);
  if (data) applyNumbers(appState, data);
  startLiveRefresh(appState, mint, loadId);
}

const readTrades = (appState, mint) => appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/trades`, { signal: AbortSignal.timeout(15000) })
  .catch(() => ({ available: false, data: null }));

// Top holders (largest token accounts) and the indexed holder count.
async function loadHolders(appState, mint, loadId, data) {
  const response = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/holders`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (loadId !== appState.coinLoadId) return;
  const body = response?.available && response.data?.mint === mint ? response.data : null;
  const count = Number.isSafeInteger(body?.holderCount) ? body.holderCount : null;
  appState.setCoinField('#coin-holder-count', count != null ? count.toLocaleString('en-US') : 'Not indexed');
  appState.coinActivity = { ...(appState.coinActivity || {}), status: 'ready', symbol: appState.coinActivity?.symbol || data?.symbol || 'TOKEN', collections: [], claims: [], accounts: [],
    holderDistribution: body?.available ? { holders: body.holders, partial: true } : null, holderCount: count ?? (body?.holders?.length ? `top ${body.holders.length}` : '—'),
    tokenDecimals: Number.isInteger(body?.decimals) ? body.decimals : 6, ledgerAvailable: false, indexedPriceUsd: data?.priceUsd ?? null };
  appState.setCoinTabLabels?.(); appState.renderCoinActivityTab?.();
}

// Trade Volumes panel: exact counts and volume from the DEX index; buy/sell
// split, traders and largest trade from the loaded trade rows.
function activityWindows(trades, indexed) {
  const now = Math.floor(Date.now() / 1000), solUsd = indexed?.solUsd;
  const oldest = trades.length ? Math.min(...trades.map(row => Number(row.blockTime))) : now;
  return Object.fromEntries([['5m', 300], ['1h', 3600], ['6h', 21600], ['24h', 86400]].map(([key, seconds]) => {
    const rows = trades.filter(row => Number(row.blockTime) >= now - seconds);
    const sol = row => Number(row.solLamports || 0) / 1e9;
    const buys = rows.filter(row => row.side === 'buy'), sells = rows.filter(row => row.side === 'sell');
    const covered = oldest <= now - seconds;
    const dex = indexed?.windows?.[key];
    const buyVolumeSol = buys.reduce((sum, row) => sum + sol(row), 0), sellVolumeSol = sells.reduce((sum, row) => sum + sol(row), 0);
    const dexVolumeSol = Number.isFinite(dex?.volumeUsd) && solUsd > 0 ? dex.volumeUsd / solUsd : null;
    const scale = !covered && dexVolumeSol && buyVolumeSol + sellVolumeSol > 0 ? dexVolumeSol / (buyVolumeSol + sellVolumeSol) : 1;
    return [key, { coverage: covered ? 'complete' : 'partial',
      tradeCount: Number.isFinite(dex?.buys) ? dex.buys + dex.sells : rows.length, buyCount: Number.isFinite(dex?.buys) ? dex.buys : buys.length, sellCount: Number.isFinite(dex?.sells) ? dex.sells : sells.length,
      traderCount: new Set(rows.map(row => row.trader).filter(Boolean)).size, volumeSol: dexVolumeSol ?? buyVolumeSol + sellVolumeSol,
      buyVolumeSol: buyVolumeSol * scale, sellVolumeSol: sellVolumeSol * scale, largestTradeSol: rows.reduce((max, row) => Math.max(max, sol(row)), 0) }];
  }));
}

function applyTrades(appState, mint, trades, tradeCount) {
  const rows = trades?.available && trades.data?.mint === mint && trades.data.available ? trades.data.trades : null;
  // A failed refresh keeps the last good rows instead of blanking the table.
  if (!rows && appState.coinMarketActivity?.indexed && appState.coinMarketActivity.status === 'ready') return;
  appState.coinMarketActivity = rows
    ? { status: 'ready', trades: rows, coverage: 'partial', decimals: trades.data.decimals, graduated: true, tradeCount: Number.isSafeInteger(tradeCount) ? tradeCount : null, indexed: true,
      activityWindows: activityWindows(rows, appState.coinIndexedWindows?.mint === mint ? appState.coinIndexedWindows : null) }
    : { status: 'unavailable', trades: [], coverage: null, decimals: 6, indexed: true };
  appState.renderCoinActivityTab?.(); appState.setCoinTabLabels?.(); appState.renderCoinPulse?.();
}

// Live numbers from a fresh overview; identity fields stay as first rendered.
function applyNumbers(appState, data) {
  const usd = value => Number.isFinite(value) ? appState.formatUsd(value) : '—';
  if (Number.isFinite(data.priceUsd)) appState.setCoinField('#coin-price', data.priceUsd < 0.01 ? `$${formatTinyDecimal(data.priceUsd)}` : usd(data.priceUsd));
  for (const selector of ['#coin-market-cap', '#coin-strip-market-cap']) if (Number.isFinite(data.marketCapUsd)) appState.setCoinField(selector, usd(data.marketCapUsd));
  if (Number.isFinite(data.volume24hUsd)) appState.setCoinField('#coin-volume', usd(data.volume24hUsd));
  appState.setCoinField('#coin-liquidity', Number.isFinite(data.liquidityUsd) ? usd(data.liquidityUsd) : data.dexId === 'pumpfun' ? 'Bonding curve' : '—');
  if (Number.isFinite(data.priceChangePercent)) appState.setCoinField('#coin-change', `${data.priceChangePercent.toFixed(2)}% · 24h`);
  // Header strip: 24h volume (USD) and trades from the DEX index, plus burned supply.
  const volumeLabel = globalThis.document?.querySelector('#coin-strip-volume')?.previousElementSibling;
  if (volumeLabel) volumeLabel.textContent = '24h volume · USD';
  appState.setCoinField('#coin-strip-volume', Number.isFinite(data.volume24hUsd) ? appState.formatCompactUsd(data.volume24hUsd) : '—');
  const trades = Number(data.buyCount24h) + Number(data.sellCount24h);
  appState.setCoinField('#coin-strip-trades', Number.isFinite(trades) ? trades.toLocaleString('en-US') : '—');
  const burnCell = globalThis.document?.querySelector('#coin-strip-burn-cell');
  if (burnCell) {
    const known = Number.isFinite(data.burnedTokens);
    burnCell.hidden = !known;
    if (known) appState.setCoinField('#coin-strip-burned', `${appState.formatCompactNumber ? appState.formatCompactNumber(data.burnedTokens) : Math.round(data.burnedTokens).toLocaleString('en-US')} · ${data.burnedPercent.toFixed(2)}%`);
  }
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
      if (data) { applyNumbers(appState, data); if (appState.coinIndexedWindows?.mint === mint) appState.coinIndexedWindows.windows = data.windows || appState.coinIndexedWindows.windows; }
      applyTrades(appState, mint, trades, data ? data.buyCount24h + data.sellCount24h : null);
      appState.renderCoinPricePath?.();
    }
    liveTimer = setTimeout(tick, LIVE_MS);
  };
  liveTimer = setTimeout(tick, LIVE_MS);
}
