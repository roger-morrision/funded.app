// Presentation helpers for bounded, confirmed Pump bonding-curve trade data.
export function verifiedRegistryLaunch(records, mint, cluster) {
  if (!Array.isArray(records)) return null;
  return records.find(item => item?.mint === mint
    && item.cluster === cluster
    && item.onchainVerified === true
    && typeof item.policySignature === 'string'
    && item.policySignature.length > 0
    && typeof item.name === 'string'
    && item.name.trim().length > 0
    && typeof item.symbol === 'string'
    && item.symbol.trim().length > 0) || null;
}

export function selectRecentTrades(trades, { side = 'all', wallet = '', minSol = 0 } = {}) {
  const walletQuery = String(wallet).trim().toLowerCase();
  const minAmount = Number(minSol);
  const threshold = Number.isFinite(minAmount) && minAmount > 0 ? minAmount : 0;
  return (Array.isArray(trades) ? trades : []).filter(item =>
    (side === 'all' || item.side === side)
    && (!walletQuery || String(item.trader || '').toLowerCase().includes(walletQuery))
    && Number(item.solLamports) / 1_000_000_000 >= threshold);
}

// Sort and filter only the trade rows supplied by the bounded activity feed.
export function filterAndSortRecentTrades(trades, filters = {}) {
  const decimals = Number(filters.decimals);
  const divisor = Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? 10 ** decimals : NaN;
  const solUsd = Number(filters.solUsd);
  const quoteReady = Number.isFinite(solUsd) && solUsd > 0;
  const bound = key => filters[key] === '' || filters[key] == null ? null : Number(filters[key]);
  const inRange = (value, minKey, maxKey) => {
    const min = bound(minKey);
    const max = bound(maxKey);
    if (min === null && max === null) return true;
    if (!Number.isFinite(value)) return false;
    return (min === null || !Number.isFinite(min) || value >= min)
      && (max === null || !Number.isFinite(max) || value <= max);
  };
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() / 1000 : null;
  const through = filters.dateTo ? new Date(`${filters.dateTo}T00:00:00`) : null;
  if (through) through.setDate(through.getDate() + 1);
  const to = through ? through.getTime() / 1000 : null;
  const wallet = String(filters.wallet || '').trim().toLowerCase();
  const signature = String(filters.signature || '').trim().toLowerCase();
  const rows = (Array.isArray(trades) ? trades : []).map((item, index) => {
    const sol = Number(item.solLamports) / 1_000_000_000;
    const token = Number(item.tokenAmountRaw) / divisor;
    const usd = quoteReady && Number.isFinite(sol) ? sol * solUsd : NaN;
    const price = quoteReady && Number.isFinite(sol) && Number.isFinite(token) && token > 0 ? usd / token : NaN;
    return { item, index, date: Number(item.blockTime), type: String(item.side || ''), usd, token, sol, price, trader: String(item.trader || ''), txn: String(item.signature || '') };
  }).filter(row => (filters.side === 'all' || !filters.side || row.type === filters.side)
    && (!wallet || row.trader.toLowerCase().includes(wallet))
    && (!signature || row.txn.toLowerCase().includes(signature))
    && (from === null || row.date >= from)
    && (to === null || row.date < to)
    && inRange(row.usd, 'minUsd', 'maxUsd')
    && inRange(row.token, 'minToken', 'maxToken')
    && inRange(row.sol, 'minSol', 'maxSol')
    && inRange(row.price, 'minPrice', 'maxPrice'));
  const key = ['date', 'type', 'usd', 'token', 'sol', 'price', 'trader', 'txn'].includes(filters.sortKey) ? filters.sortKey : 'date';
  const direction = filters.sortDirection === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const left = a[key];
    const right = b[key];
    const leftMissing = typeof left === 'number' && !Number.isFinite(left);
    const rightMissing = typeof right === 'number' && !Number.isFinite(right);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    const comparison = typeof left === 'number' ? left - right : left.localeCompare(right);
    return (comparison || 0) * direction || a.index - b.index;
  });
  return rows.map(row => row.item);
}

export function buildTradePricePath(trades, decimals) {
  const scale = (10 ** Number(decimals)) / 1_000_000_000;
  if (!Number.isFinite(scale) || scale <= 0) return { count: 0 };
  const observations = (Array.isArray(trades) ? trades : [])
    .map(item => ({ blockTime: item.blockTime, price: Number(item.priceRatio) * scale }))
    .filter(item => Number.isFinite(item.price) && item.price > 0)
    .reverse();
  if (observations.length < 2) return { count: observations.length };
  const prices = observations.map(item => item.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const spread = high - low;
  const firstTime = Number(observations[0].blockTime);
  const lastTime = Number(observations.at(-1).blockTime);
  const useTimeAxis = observations.every(item => Number.isFinite(Number(item.blockTime))) && lastTime > firstTime && observations.every((item, index) => index === 0 || Number(item.blockTime) >= Number(observations[index - 1].blockTime));
  const points = prices.map((price, index) => ({
    x: 24 + (useTimeAxis ? (Number(observations[index].blockTime) - firstTime) / (lastTime - firstTime) : index / (prices.length - 1)) * 552,
    y: spread ? 158 - (price - low) / spread * 116 : 100,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return {
    count: observations.length,
    latest: prices.at(-1), low, high,
    firstBlockTime: observations[0].blockTime,
    lastBlockTime: observations.at(-1).blockTime,
    points,
    line,
    area: `${line} L576 176 L24 176 Z`,
    lastPoint: points.at(-1),
  };
}

export function selectObservedTradeWindow(trades, period, nowSeconds = Date.now() / 1000) {
  const seconds = { '5m': 300, '1h': 3600, '6h': 21600, '24h': 86400 }[period] || 86400;
  const cutoff = nowSeconds - seconds;
  return (Array.isArray(trades) ? trades : []).filter(item => {
    const time = Number(item?.blockTime);
    return Number.isFinite(time) && time >= cutoff && time <= nowSeconds + 120;
  });
}

export function summarizeTokenAccounts(accounts, curveVaultAddress) {
  const sample = Array.isArray(accounts) ? accounts : [];
  const vault = curveVaultAddress ? sample.find(item => item.address === curveVaultAddress) : null;
  if (!vault || !Number.isFinite(vault.share)) return null;
  const others = sample.filter(item => item.address !== curveVaultAddress && Number.isFinite(item.share));
  const shares = others.map(item => item.share).sort((a, b) => b - a);
  const otherShare = shares.reduce((sum, share) => sum + share, 0);
  const sampledShare = vault.share + otherShare;
  return {
    vaultAddress: curveVaultAddress,
    vaultShare: vault.share,
    otherCount: others.length,
    otherShare,
    largestOtherShare: shares[0] ?? 0,
    topTenOtherShare: shares.slice(0, 10).reduce((sum, share) => sum + share, 0),
    outsideSampleShare: Math.max(0, 100 - sampledShare),
  };
}
