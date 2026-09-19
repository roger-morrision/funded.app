const finite = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function enrichMarketRecord(record = {}) {
  const volume24hUsd = finite(record.volume24hUsd ?? record.volume_24h_usd ?? record.volume24h);
  const marketCapUsd = finite(record.marketCapUsd ?? record.market_cap_usd);
  const liquidityUsd = finite(record.liquidityUsd ?? record.liquidity_usd);
  const holders = finite(record.holders ?? record.holderCount ?? record.holder);
  const priceChange24hPercent = finite(record.priceChange24hPercent ?? record.price_change_24h_percent);
  const turnover = volume24hUsd != null && marketCapUsd > 0 ? volume24hUsd / marketCapUsd : null;
  const riskFlags = [];

  if (liquidityUsd == null) riskFlags.push('liquidity-unavailable');
  else if (liquidityUsd < 10_000) riskFlags.push('thin-liquidity');
  if (marketCapUsd == null) riskFlags.push('market-cap-unavailable');
  if (turnover != null && turnover >= 5) riskFlags.push('extreme-turnover');
  else if (turnover != null && turnover >= 1) riskFlags.push('high-turnover');
  if (Math.abs(priceChange24hPercent || 0) >= 50) riskFlags.push('high-volatility');
  if (record.complete === false) riskFlags.push('bonding-curve');

  return {
    ...record,
    volume24hUsd,
    marketCapUsd,
    liquidityUsd,
    holders,
    priceChange24hPercent,
    turnover,
    riskFlags,
    riskLevel: riskFlags.includes('extreme-turnover') || riskFlags.includes('thin-liquidity') ? 'high' : riskFlags.length ? 'watch' : 'normal',
  };
}

export function sortMarketRecords(records, sort = 'market-cap') {
  const value = record => {
    if (sort === 'volume') return record.volume24hUsd ?? -1;
    if (sort === 'turnover') return record.turnover ?? -1;
    if (sort === 'liquidity') return record.liquidityUsd ?? -1;
    if (sort === 'holders') return record.holders ?? -1;
    if (sort === 'change') return record.priceChange24hPercent ?? -Infinity;
    if (sort === 'newest') {
      const timestamp = Number(record.createdTimestamp || record.lastTradeUnixTime || 0);
      return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    }
    return record.marketCapUsd ?? -1;
  };
  return [...records].sort((a, b) => value(b) - value(a));
}

export function filterMarketRecords(records, { query = '', risk = 'all', sort = 'market-cap', watchlist = [] } = {}) {
  const normalized = String(query).trim().toLowerCase();
  const saved = new Set(watchlist);
  const filtered = records.filter(record => {
    const searchable = `${record.symbol || ''} ${record.name || ''} ${record.address || ''} ${record.quoteSymbol || ''}`.toLowerCase();
    if (normalized && !searchable.includes(normalized)) return false;
    if (risk === 'watchlist') {
      if (!saved.has(record.address || record.mint)) return false;
    } else if (risk !== 'all' && record.riskLevel !== risk) return false;
    return true;
  });
  return sortMarketRecords(filtered, sort);
}

export function summarizeMarkets(records) {
  const values = records.map(enrichMarketRecord);
  const recordedVolume = values.filter(item => item.volume24hUsd != null);
  const recordedLiquidity = values.filter(item => item.liquidityUsd != null);
  const volume = recordedVolume.length ? recordedVolume.reduce((sum, item) => sum + item.volume24hUsd, 0) : null;
  const liquidity = recordedLiquidity.length ? recordedLiquidity.reduce((sum, item) => sum + item.liquidityUsd, 0) : null;
  const highRisk = values.filter(item => item.riskLevel === 'high').length;
  const priced = values.filter(item => item.marketCapUsd != null);
  return { count: values.length, volume24hUsd: volume, liquidityUsd: liquidity, highRisk, priced };
}

export function formatSignal(value, suffix = '') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value))}${suffix}`;
}
