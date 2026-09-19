import { createHash } from 'node:crypto';

export const DEFAULT_QUOTE_ASSETS = Object.freeze([
  { id: 'sol', symbol: 'SOL', name: 'Solana', mint: 'So11111111111111111111111111111111111111112', status: 'verified', category: 'native' },
  { id: 'usdc', symbol: 'USDC', name: 'USD Coin', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', status: 'verified', category: 'stablecoin' },
]);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function quoteAssetCatalog(extra = []) {
  const records = [...DEFAULT_QUOTE_ASSETS, ...(Array.isArray(extra) ? extra : [])]
    .map(item => ({ id: String(item.id || item.symbol || '').toLowerCase(), symbol: String(item.symbol || '').toUpperCase(), name: String(item.name || item.symbol || 'Unknown quote'), mint: String(item.mint || ''), status: item.status === 'verified' ? 'verified' : 'review', category: String(item.category || 'custom'), source: item.source || 'funded.app-config' }))
    .filter(item => item.id && item.symbol && item.mint && item.status === 'verified');
  return [...new Map(records.map(item => [item.mint, item])).values()];
}

export function buildTerminalSignal(record = {}) {
  const liquidity = finite(record.liquidityUsd);
  const volume = finite(record.volume24hUsd);
  const marketCap = finite(record.marketCapUsd);
  const holders = finite(record.holders);
  const turnover = volume != null && marketCap > 0 ? volume / marketCap : null;
  const progress = finite(record.curveProgressPercent ?? record.progressPercent);
  const risk = [];
  if (liquidity == null) risk.push('liquidity-unavailable');
  else if (liquidity < 10_000) risk.push('thin-liquidity');
  if (turnover != null && turnover >= 5) risk.push('extreme-turnover');
  else if (turnover != null && turnover >= 1) risk.push('high-turnover');
  if (Math.abs(finite(record.priceChange24hPercent) || 0) >= 50) risk.push('high-volatility');
  if (holders != null && holders < 25) risk.push('concentrated-holder-base');
  return {
    graduationProgress: progress,
    turnover,
    riskFlags: risk,
    riskLevel: risk.includes('extreme-turnover') || risk.includes('thin-liquidity') ? 'high' : risk.length ? 'watch' : 'normal',
    signalScore: Math.max(0, Math.min(100, Math.round((progress || 0) * 0.35 + Math.min(35, Math.log10(Math.max(1, volume || 0)) * 4) + Math.min(20, Math.log10(Math.max(1, holders || 0)) * 5) - risk.length * 8))),
  };
}

export function creatorReputation(launches = [], settlements = []) {
  const records = Array.isArray(launches) ? launches : Object.values(launches || {});
  const creator = new Map();
  for (const launch of records) {
    const wallet = String(launch.creatorWallet || launch.creator || '').trim();
    if (!wallet) continue;
    const current = creator.get(wallet) || { wallet, launches: 0, graduated: 0, totalVolumeUsd: 0, lastLaunchAt: null };
    current.launches += 1;
    if (launch.complete === true || launch.graduated === true || launch.raydiumPool) current.graduated += 1;
    current.totalVolumeUsd += finite(launch.volume24hUsd) || 0;
    current.lastLaunchAt = [current.lastLaunchAt, launch.createdAt || launch.updatedAt].filter(Boolean).sort().at(-1) || null;
    creator.set(wallet, current);
  }
  const settlementByWallet = new Map();
  for (const item of Array.isArray(settlements) ? settlements : Object.values(settlements || {})) {
    const wallet = String(item.creatorWallet || '').trim();
    if (wallet) settlementByWallet.set(wallet, (settlementByWallet.get(wallet) || 0) + (finite(item.grossCreatorFees) || 0));
  }
  return [...creator.values()].map(item => ({ ...item, settledFees: settlementByWallet.get(item.wallet) || 0, graduationRate: item.launches ? item.graduated / item.launches : 0, reputationScore: Math.max(0, Math.min(100, Math.round(item.graduated / Math.max(1, item.launches) * 60 + Math.min(25, Math.log10(Math.max(1, item.settledFees || 0)) * 5) + Math.min(15, item.launches * 2)))) })).sort((a, b) => b.reputationScore - a.reputationScore);
}

export function immutableLaunchReview(input = {}) {
  const snapshot = {
    chain: 'solana',
    mint: String(input.mint || '').trim(),
    name: String(input.name || '').trim().slice(0, 80),
    symbol: String(input.symbol || '').trim().toUpperCase().slice(0, 16),
    creatorWallet: String(input.creatorWallet || '').trim(),
    quoteMint: String(input.quoteMint || '').trim(),
    quoteSymbol: String(input.quoteSymbol || '').trim().toUpperCase(),
    feeBps: Number(input.feeBps || 0),
    policy: input.policy || null,
    risk: input.risk || null,
    createdAt: new Date().toISOString(),
  };
  const reviewHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return Object.freeze({ ...snapshot, reviewHash, status: 'awaiting-wallet-signature' });
}

export function normalizeXIntake(input = {}) {
  const handle = String(input.handle || '').trim().replace(/^@/, '').slice(0, 15);
  const request = String(input.request || '').trim().slice(0, 500);
  if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('A valid X handle is required.');
  if (!request) throw new Error('A launch request is required.');
  return { handle: `@${handle}`, request, sourceUrl: String(input.sourceUrl || '').trim().slice(0, 500) || null, status: 'queued-for-review', submittedAt: new Date().toISOString() };
}
