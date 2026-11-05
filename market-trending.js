// Rank observed participation, not people or profit. Wallets may share an owner.
// Only the server's decoded trade events feed this metric; paid boosts do not.
export function summarizeTrending(records, cutoffSeconds, nowSeconds) {
  const wallets = new Map(), buckets = new Set(), seen = new Set();
  let latest = 0, volume = 0, trades = 0;
  for (const row of records) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.trader || '')
      || !Number.isFinite(row.blockTime) || row.blockTime < cutoffSeconds || row.blockTime > nowSeconds
      || !['bigint','number','string'].includes(typeof row.solLamports)) continue;
    const amount = Number(row.solLamports) / 1e9;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = `${row.signature}:${row.trader}:${row.isBuy}:${row.solLamports}:${row.tokenAmountRaw}`;
    if (!row.signature || seen.has(key)) continue;
    seen.add(key); trades++; volume += amount; latest = Math.max(latest, row.blockTime);
    wallets.set(row.trader, (wallets.get(row.trader) || 0) + amount);
    buckets.add(Math.floor(row.blockTime / 300));
  }
  const concentration = volume ? Math.max(...wallets.values()) / volume : null;
  const concentrated = trades >= 4 && concentration >= .8;
  // Each wallet's volume has diminishing influence and a strict upper bound.
  const participation = [...wallets.values()].reduce((sum, amount) => sum + Math.min(2, Math.log1p(amount)), 0);
  const freshness = latest ? 1 / (1 + (nowSeconds - latest) / Math.max(300, (nowSeconds - cutoffSeconds) / 4)) : 0;
  const score = wallets.size < 2 ? 0 : (3 * Math.sqrt(wallets.size) + participation + Math.sqrt(Math.min(12, buckets.size)))
    * freshness * (concentrated ? .5 : 1);
  return { score, walletCount:wallets.size, activeIntervals:buckets.size, topWalletVolumeShare:concentration,
    concentrated, latestTradeAt:latest || null, basis:'observed-wallet-participation-v1' };
}

export function trendingMetric(record, period = record.windowPeriod || '24h') {
  const window = record.activityWindows?.[period], metric = window?.trending;
  if (!['partial','complete'].includes(window?.coverage) || metric?.basis !== 'observed-wallet-participation-v1'
    || !Number.isFinite(metric.score) || metric.score < 0 || !Number.isInteger(metric.walletCount) || metric.walletCount < 0) return null;
  return metric;
}

export function rankTrending(records, period) {
  return [...records].sort((a,b) => (trendingMetric(b,period)?.score ?? -1) - (trendingMetric(a,period)?.score ?? -1)
    || String(a.address || '').localeCompare(String(b.address || '')));
}
