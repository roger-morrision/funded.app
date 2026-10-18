import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DAILY_BONUS_POLICY } from '../config/daily-bonus.js';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';

export const bonusHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wallet = value => new PublicKey(value).toBase58();
const compareText = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const amount = value => {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Daily bonus amounts must be integer lamports.');
  return BigInt(value);
};
export function dailyBonusWindow(day, now = Math.floor(Date.now() / 1000)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('A UTC day in YYYY-MM-DD format is required.');
  const start = Date.parse(`${day}T00:00:00Z`) / 1000, end = start + 86_400;
  if (!Number.isSafeInteger(start) || new Date(start * 1000).toISOString().slice(0, 10) !== day
    || end > now) throw new Error('A completed UTC day is required.');
  return { day, start, end };
}
export function latestBonusDay(now = Math.floor(Date.now() / 1000)) {
  return new Date((Math.floor(now / 86_400) * 86_400 - 86_400) * 1000).toISOString().slice(0, 10);
}
export function splitBonusLamports(total, weights) {
  const denominator = BigInt(weights.reduce((sum, n) => sum + n, 0));
  const rows = weights.map((weight, index) => ({ index, value:total * BigInt(weight) / denominator,
    remainder:total * BigInt(weight) % denominator }));
  let dust = total - rows.reduce((sum, row) => sum + row.value, 0n);
  for (const row of [...rows].sort((a, b) => a.remainder === b.remainder
    ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (dust-- > 0n) row.value++;
  }
  return rows.map(row => row.value);
}
function dedupe(rows, key) {
  const seen = new Map();
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id) && bonusHash(seen.get(id)) !== bonusHash(row)) throw new Error('Conflicting daily bonus evidence.');
    seen.set(id, row);
  }
  return [...seen.values()].sort((a, b) => compareText(key(a), key(b)));
}
export function buildDailyBonusSnapshot({ day, collections, trades, coverage, now }) {
  const window = dailyBonusWindow(day, now);
  if (!Array.isArray(coverage) || coverage.some(row => row.complete !== true))
    throw new Error('Complete finalized trading coverage is required for every registered mint.');
  const fees = dedupe(collections, row => row.signature);
  const events = dedupe(trades, row => `${row.signature}:${row.logIndex}:${row.mint}`);
  const covered = new Set(coverage.map(row => wallet(row.mint)));
  if ([...fees, ...events].some(row => !covered.has(wallet(row.mint))))
    throw new Error('Daily bonus evidence contains a mint outside complete coverage.');
  const totals = Object.fromEntries(DAILY_BONUS_POLICY.categories.map(key => [key, new Map()]));
  const include = (category, recipient, value) => {
    const key = wallet(recipient), parsed = amount(value);
    if (parsed > 0n) totals[category].set(key, (totals[category].get(key) || 0n) + parsed);
  };
  const inWindow = row => Number.isSafeInteger(row.blockTime) && row.blockTime >= window.start && row.blockTime < window.end;
  for (const row of fees) {
    if (row.finalized !== true || !inWindow(row)) throw new Error('Collection does not belong to the finalized UTC day.');
    include('creators', row.creator, row.amountLamports);
    if (row.referrer) include('referrals', row.referrer, row.amountLamports);
  }
  for (const row of events) {
    if (row.finalized !== true || !inWindow(row)) throw new Error('Trade does not belong to the finalized UTC day.');
    include('traders', row.wallet, row.amountLamports);
  }
  const rankings = Object.fromEntries(DAILY_BONUS_POLICY.categories.map(category => [category,
    [...totals[category]].sort((a, b) => a[1] === b[1] ? compareText(a[0], b[0]) : a[1] > b[1] ? -1 : 1)
      .slice(0, 3).map(([recipient, score], index) => ({ rank:index + 1, wallet:recipient,
        scoreLamports:String(score), percentOfCategory:DAILY_BONUS_POLICY.rankPercents[index], bonusLamports:'0' }))]));
  const sources = fees.filter(row => row.dailyBonusVersion === 1 && amount(row.communityLamports) > 0n).map(row => {
    const budget = amount(row.communityLamports), groups = splitBonusLamports(budget, DAILY_BONUS_POLICY.categoryWeights), allocations = new Map();
    DAILY_BONUS_POLICY.categories.forEach((category, group) => {
      const ranks = splitBonusLamports(groups[group], DAILY_BONUS_POLICY.rankPercents);
      for (const winner of rankings[category]) {
        const reward = ranks[winner.rank - 1];
        winner.bonusLamports = String(BigInt(winner.bonusLamports) + reward);
        if (reward > 0n) allocations.set(winner.wallet, (allocations.get(winner.wallet) || 0n) + reward);
      }
    });
    const paid = [...allocations.values()].reduce((sum, n) => sum + n, 0n);
    return { collectionSignature:row.signature, settlementSignature:row.settlementSignature,
      mint:row.mint, amountLamports:String(budget), payableLamports:String(paid),
      retainedLamports:String(budget - paid), allocations:[...allocations].sort((a, b) => compareText(a[0], b[0]))
        .map(([recipient, value]) => ({ recipient, amount:String(value) })) };
  });
  const snapshot = { version:1, ...window, policy:DAILY_BONUS_POLICY, rankings, sources,
    evidence:{ collections:fees, trades:events, coverage:[...coverage].sort((a, b) => compareText(a.mint, b.mint)) } };
  return { ...snapshot, hash:bonusHash(snapshot) };
}
export function dailyBonusManifest(snapshot, source) {
  if (!source.allocations.length) return null;
  const cycleId = createRewardCycleId({ mint:source.mint,
    kind:`daily-bonus-v1:${source.collectionSignature}`, asset:'SOL',
    periodStart:snapshot.start, periodEnd:snapshot.end });
  return buildRewardManifest({ cycleId, asset:'SOL', allocations:source.allocations });
}
