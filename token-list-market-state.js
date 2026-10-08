// Reward lists reuse the feed's mint, curve and pool checks.
let markets = new Map();
export function publishTokenListMarkets(items, cluster, solUsdPrice) {
  markets = new Map(items.map(item => [item.address, {
    createdTimestamp: item.createdTimestamp,
    marketCap: tokenMarketCap(item, cluster, solUsdPrice),
  }]));
  document.dispatchEvent(new Event('funded:token-list-markets'));
}
export function tokenListMarket(mint) { return markets.get(mint); }

export function tokenMarketCap(item, cluster, solUsdPrice) {
  const raw = cluster === 'devnet'
    ? item.migrated === true ? item.poolMarketCapSol : item.complete === false ? item.curveCapSol : null
    : item.marketCapUsd;
  if (raw == null || raw === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0) return 'Unavailable';
  const hasQuote = Number.isFinite(solUsdPrice) && solUsdPrice > 0;
  const amount = Number(raw) * (cluster === 'devnet' && hasQuote ? solUsdPrice : 1);
  const formatted = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(amount);
  return cluster === 'devnet' && !hasQuote ? `${formatted} SOL` : `$${formatted}`;
}

export function tokenAge(value, now = Date.now()) {
  const numeric = typeof value === 'number' ? value : NaN;
  const timestamp = Number.isFinite(numeric) ? numeric < 1e12 ? numeric * 1000 : numeric : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return { label: 'Unavailable', timestamp: null };
  const seconds = Math.floor((now - timestamp) / 1000);
  const label = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
  return { label, timestamp: new Date(timestamp).toISOString() };
}
