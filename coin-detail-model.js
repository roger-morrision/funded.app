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
  const points = prices.map((price, index) => ({
    x: 24 + index * 552 / (prices.length - 1),
    y: spread ? 158 - (price - low) / spread * 116 : 100,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return {
    count: observations.length,
    latest: prices.at(-1), low, high,
    firstBlockTime: observations[0].blockTime,
    lastBlockTime: observations.at(-1).blockTime,
    line,
    area: `${line} L576 176 L24 176 Z`,
    lastPoint: points.at(-1),
  };
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
