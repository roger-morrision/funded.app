import {formatTinyDecimal} from '../shared/display.js';
// Display-only fallback. Never populate curve reserves, wallet balances or trade quotes.
export function renderIndexedMarket(appState, market, mint, now = Date.now()) {
  const at = Date.parse(market?.observedAt);
  if (appState.EXPLORE_CLUSTER !== 'mainnet-beta' || market?.cluster !== 'mainnet-beta'
    || market?.mint !== mint || !['birdeye','dexscreener'].includes(market?.source) || !market.displayOnly
    || !Number.isFinite(at) || now-at > 60_000 || at-now > 5000) return false;
  const usd = value => value != null && Number.isFinite(value) ? appState.formatUsd(value) : '—';
  if (market.name) appState.setCoinField('#coin-page-title',market.name);
  if (market.symbol) appState.setCoinField('#coin-symbol',market.symbol);
  for (const selector of ['#coin-market-cap','#coin-strip-market-cap']) appState.setCoinField(selector,usd(market.marketCapUsd));
  appState.setCoinField('#coin-price',market.priceUsd != null && market.priceUsd > 0 && market.priceUsd < 0.01
    ? `$${formatTinyDecimal(market.priceUsd)}` : usd(market.priceUsd));
  appState.setCoinField('#coin-volume',usd(market.volume24hUsd));
  if (market.liquidityUsd != null) appState.setCoinField('#coin-liquidity',usd(market.liquidityUsd));
  appState.setCoinField('#coin-holder-count',market.holders == null ? '—' : String(market.holders));
  appState.setCoinField('#coin-trade-count',market.tradeCount24h == null ? '—' : String(market.tradeCount24h));
  appState.setCoinField('#coin-change',market.priceChangePercent == null ? '—' : `${market.priceChangePercent.toFixed(2)}% · 24h`);
  const provider=market.source==='dexscreener'?'DexScreener':'Birdeye';
  appState.setCoinField('#coin-market-cap-source',`${provider} · indexed market data`);
  appState.setCoinField('#coin-volume-source',`${provider} · 24h indexed volume`);
  appState.setCoinField('#coin-trade-breakdown',market.buyCount24h != null && market.sellCount24h != null
    ? `${market.buyCount24h} buys · ${market.sellCount24h} sells` : 'Indexed summary');
  return true;
}
