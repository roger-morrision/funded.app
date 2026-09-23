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
  const volume24hSol = finite(record.volume24hSol);
  const tradeCount24h = finite(record.tradeCount24h);
  const buyCount24h = finite(record.buyCount24h);
  const sellCount24h = finite(record.sellCount24h);
  const curveCapSol = finite(record.curveCapSol);
  const curveReserveSol = finite(record.curveReserveSol);
  const turnover = volume24hUsd != null && marketCapUsd > 0 ? volume24hUsd / marketCapUsd : volume24hSol != null && curveCapSol > 0 ? volume24hSol / curveCapSol : null;
  const riskFlags = [];

  if (liquidityUsd == null && curveReserveSol == null) riskFlags.push('liquidity-unavailable');
  else if (liquidityUsd != null && liquidityUsd < 10_000) riskFlags.push('thin-liquidity');
  if (marketCapUsd == null && curveCapSol == null) riskFlags.push('market-cap-unavailable');
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
    volume24hSol,
    tradeCount24h,
    buyCount24h,
    sellCount24h,
    curveCapSol,
    curveReserveSol,
    turnover,
    riskFlags,
    riskLevel: riskFlags.includes('extreme-turnover') || riskFlags.includes('thin-liquidity') ? 'high' : riskFlags.length ? 'watch' : 'normal',
  };
}

export function withMarketWindow(record, period = '24h') {
  const market = enrichMarketRecord(record);
  const window = ['1h', '6h', '24h'].includes(period) ? period : '24h';
  const indexed = market.activityWindows?.[window];
  const nonnegative = value => { const number = finite(value); return number != null && number >= 0 ? number : null; };
  const count = value => { const number = nonnegative(value); return number != null && Number.isInteger(number) ? number : null; };
  const volume = indexed ? nonnegative(indexed.volumeSol) : window === '24h' ? nonnegative(market.volume24hSol) : null;
  const trades = indexed ? count(indexed.tradeCount) : window === '24h' ? count(market.tradeCount24h) : null;
  return {
    ...market,
    windowPeriod: window,
    windowVolumeSol: volume,
    windowTradeCount: trades,
    windowBuyCount: indexed ? count(indexed.buyCount) : window === '24h' ? count(market.buyCount24h) : null,
    windowSellCount: indexed ? count(indexed.sellCount) : window === '24h' ? count(market.sellCount24h) : null,
    windowTraderCount: indexed ? count(indexed.traderCount) : null,
    windowCoverage: indexed?.coverage === 'partial' || indexed?.coverage === 'complete' ? indexed.coverage : market.volumeCoverage,
    windowTurnover: volume != null && market.curveCapSol > 0 ? volume / market.curveCapSol : null,
  };
}

export function sortMarketRecords(records, sort = 'market-cap') {
  const value = record => {
    if (sort === 'volume') return record.windowPeriod ? record.windowVolumeSol ?? -1 : record.volume24hUsd ?? record.volume24hSol ?? -1;
    if (sort === 'airdrop') return record.communityAirdropPercent ?? -1;
    if (sort === 'holder-fee') return record.holderFeePercent ?? -1;
    if (sort === 'x-fee') return record.xFeePercent ?? -1;
    if (sort === 'trades') return record.windowPeriod ? record.windowTradeCount ?? -1 : record.tradeCount24h ?? -1;
    if (sort === 'turnover') return record.windowPeriod ? record.windowTurnover ?? -1 : record.turnover ?? -1;
    if (sort === 'liquidity') return record.liquidityUsd ?? record.curveReserveSol ?? -1;
    if (sort === 'holders') return record.holders ?? -1;
    if (sort === 'change') return record.priceChange24hPercent ?? -Infinity;
    if (sort === 'recent-trade') {
      const timestamp = Number(record.lastTradeUnixTime || record.createdTimestamp || 0);
      return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    }
    if (sort === 'newest') {
      const timestamp = Number(record.createdTimestamp || record.lastTradeUnixTime || 0);
      return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    }
    return record.marketCapUsd ?? record.curveCapSol ?? -1;
  };
  return [...records].sort((a, b) => value(b) - value(a));
}

export function filterMarketRecords(records, { query = '', risk = 'all', stage = 'all', authority = 'all', promotion = 'all', reward = 'all', sort = 'market-cap', watchlist = [], maxAgeHours = null, minVolumeSol = null, minCurveCapSol = null, minTrades = null, minTraders = null, nowMs = Date.now() } = {}) {
  const normalized = String(query).trim().toLowerCase();
  const saved = new Set(watchlist);
  const filtered = records.filter(record => {
    const searchable = `${record.symbol || ''} ${record.name || ''} ${record.address || ''} ${record.quoteSymbol || ''}`.toLowerCase();
    if (normalized && !searchable.includes(normalized)) return false;
    if (stage === 'curve' && record.complete !== false) return false;
    if (stage === 'launch' && record.complete !== false) return false;
    if (stage === 'near' && !(record.complete === false && record.curveProgressPercent != null && record.curveProgressPercent >= 80)) return false;
    if (stage === 'graduated' && record.complete !== true) return false;
    if (stage === 'migrated' && !(record.complete === true && record.migrated === true)) return false;
    if (authority === 'both-revoked' && !(record.mintAuthorityRevoked === true && record.freezeAuthorityRevoked === true)) return false;
    if (authority === 'mint-active' && record.mintAuthorityRevoked !== false) return false;
    if (authority === 'freeze-active' && record.freezeAuthorityRevoked !== false) return false;
    if (promotion === 'promoted' && !['boost', 'pro', 'premier'].includes(record.promotionTier)) return false;
    if (['standard', 'boost', 'pro', 'premier'].includes(promotion) && record.promotionTier !== promotion) return false;
    if (reward === 'community-airdrop' && !(record.communityAirdropPercent > 0)) return false;
    if (reward === 'holder-fees' && !(record.holderFeePercent > 0)) return false;
    if (reward === 'x-fees' && !(record.xFeePercent > 0)) return false;
    if (reward === 'creator-wallet' && !(record.creatorFeePercent > 0)) return false;
    const created = Number(record.createdTimestamp);
    const createdMs = created > 10_000_000_000 ? created : created * 1000;
    if (maxAgeHours != null && (!Number.isFinite(createdMs) || createdMs <= 0 || createdMs > nowMs || nowMs - createdMs > Number(maxAgeHours) * 3_600_000)) return false;
    const volumeSol = record.windowPeriod ? record.windowVolumeSol : record.volume24hSol;
    const tradeCount = record.windowPeriod ? record.windowTradeCount : record.tradeCount24h;
    if (minVolumeSol != null && (volumeSol == null || volumeSol < Number(minVolumeSol))) return false;
    if (minCurveCapSol != null && (record.curveCapSol == null || record.curveCapSol < Number(minCurveCapSol))) return false;
    if (minTrades != null && (tradeCount == null || tradeCount < Number(minTrades))) return false;
    if (minTraders != null && (record.windowTraderCount == null || record.windowTraderCount < Number(minTraders))) return false;
    if (risk === 'watchlist') {
      if (!saved.has(record.address || record.mint)) return false;
    } else if (risk !== 'all' && record.riskLevel !== risk) return false;
    return true;
  });
  return sortMarketRecords(filtered, sort);
}

export function collectRecentTrades(records, { limit = 10, since = null } = {}) {
  const trades = records.flatMap(record => (Array.isArray(record.recentTrades) ? record.recentTrades : []).flatMap(trade => {
    const blockTime = Number(trade?.blockTime);
    const lamports = String(trade?.solLamports ?? '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(String(trade?.signature || '')) || !['buy', 'sell'].includes(trade?.side)
      || !Number.isFinite(blockTime) || blockTime <= 0 || (since != null && blockTime < since) || !/^\d+$/.test(lamports)) return [];
    const solAmount = Number(lamports) / 1_000_000_000;
    if (!Number.isFinite(solAmount)) return [];
    return [{ ...trade, blockTime, solAmount, mint: record.address, symbol: record.symbol, coverage: record.volumeCoverage }];
  }));
  return trades.sort((a, b) => b.blockTime - a.blockTime).slice(0, Math.max(0, limit));
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
