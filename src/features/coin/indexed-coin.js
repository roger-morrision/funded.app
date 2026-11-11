import { renderIndexedMarket } from './indexed-market.js';
import { formatTinyDecimal } from '../shared/display.js';

// Mainnet token page without per-visitor RPC reads: the server's cached
// overview (DexScreener/Jupiter first, Birdeye fallback) fills the header,
// candles come from the indexed OHLC route and trades are routed by Jupiter.
export async function loadIndexedCoin(appState, mint, loadId, marketRequest) {
  const current = () => loadId === appState.coinLoadId;
  const overviewRequest = appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/overview`, { signal: AbortSignal.timeout(15000) })
    .catch(() => ({ available: false, data: null }));
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
    appState.setCoinField('#coin-volume', usd(data.volume24hUsd)); appState.setCoinField('#coin-liquidity', usd(data.liquidityUsd));
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
    const solUsd = Number(appState.coinSolUsdPrice) > 0 ? Number(appState.coinSolUsdPrice)
      : Number((await appState.apiRequest('/api/market/sol-usd', { signal: AbortSignal.timeout(6000) }).catch(() => null))?.data?.priceUsd) || null;
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
  const [market, trades] = await Promise.all([marketRequest,
    appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/trades`, { signal: AbortSignal.timeout(15000) }).catch(() => ({ available: false, data: null }))]);
  if (!current()) return;
  const rows = trades.available && trades.data?.mint === mint && trades.data.available ? trades.data.trades : null;
  const tradeCount = market?.data?.tradeCount24h;
  appState.coinMarketActivity = rows
    ? { status: 'ready', trades: rows, coverage: 'partial', decimals: trades.data.decimals, graduated: true, tradeCount: Number.isSafeInteger(tradeCount) ? tradeCount : null, indexed: true }
    : { status: 'unavailable', trades: [], coverage: null, decimals: 6, indexed: true };
  appState.renderCoinActivityTab?.(); appState.setCoinTabLabels?.();
  if (market?.available) renderIndexedMarket(appState, market.data, mint);
  else if (data) appState.setCoinField('#coin-liquidity', Number.isFinite(data.liquidityUsd) ? appState.formatUsd(data.liquidityUsd) : '—');
}
