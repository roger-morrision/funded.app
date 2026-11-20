import {bonusSnapshotIdentity} from './daily-bonus-network.mjs';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { DAILY_BONUS_POLICY, DAILY_BONUS_PAYOUT_ASSET } from '../config/daily-bonus.js';
import { buildRewardManifest, createRewardCycleId } from '../reward-merkle.js';
import { bonusUsdMicros } from './daily-bonus-helius-price.mjs';
import { bonusQuoteAsset } from './daily-bonus-usd-score.mjs';
import { bonusWindow as dailyBonusWindow } from './daily-bonus-schedule.mjs';
export { bonusWindow as dailyBonusWindow, latestBonusDay } from './daily-bonus-schedule.mjs';

export const bonusHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wallet = value => new PublicKey(value).toBase58();
const compareText = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const amount = value => {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Daily bonus amounts must be integer lamports.');
  return BigInt(value);
};
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
export function allocateDailyBonusSource(row, rankings) {
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
}
export function buildDailyBonusSnapshot({ day, cluster='devnet', programId, collections, trades, coverage, now, excludedCollectionSignatures = [], eligibilityBasis='collection-time-v1', traderEligibility=DAILY_BONUS_POLICY.traderEligibility, scoringBasis='lamports-v1' }) {
  if(!['collection-time-v1','settlement-time-v1'].includes(eligibilityBasis))throw new Error('Unknown bonus eligibility basis.');
  if(!['all-wallets-v1','direct-signers-v1'].includes(traderEligibility))throw new Error('Unknown trader bonus eligibility.');
  if(!['lamports-v1','common-usd-v2'].includes(scoringBasis))throw new Error('Unknown bonus scoring basis.');
  const commonUsd=scoringBasis==='common-usd-v2';
  const settlementTime=eligibilityBasis==='settlement-time-v1';
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
  const verifiedScore = (row, at) => {
    const quote=bonusQuoteAsset(row.quoteMint,cluster);
    if (row.quoteAsset!==quote.asset || row.quoteDecimals!==quote.decimals
      || bonusUsdMicros({asset:quote.asset,amountRaw:row.amountRaw,decimals:quote.decimals,
        tradeTime:at,priceEvidence:row.priceEvidence})!==String(row.scoreUsdMicros))
      throw new Error('Daily bonus common USD evidence does not reproduce its ranking score.');
    return row.scoreUsdMicros;
  };
  for (const row of fees) {
    if (row.finalized !== true || !(settlementTime?inWindow({blockTime:row.settlementBlockTime}):inWindow(row))) throw new Error('Collection does not belong to the finalized UTC day.');
    const score=commonUsd?verifiedScore(row,settlementTime?row.settlementBlockTime:row.blockTime):row.amountLamports;
    include('creators', row.creator, score);
    if (row.referrer) include('referrals', row.referrer, score);
  }
  for (const row of events) {
    if (row.finalized !== true || !inWindow(row)) throw new Error('Trade does not belong to the finalized UTC day.');
    const score=commonUsd?verifiedScore(row,row.blockTime):row.amountLamports;
    // Keep excluded trades as verified evidence, but do not let a program address
    // take a rank or dilute the directly signable wallets' category awards.
    if (traderEligibility === 'direct-signers-v1' && !PublicKey.isOnCurve(new PublicKey(row.wallet).toBytes())) continue;
    include('traders', row.wallet, score);
  }
  const rankings = Object.fromEntries(DAILY_BONUS_POLICY.categories.map(category => [category,
    [...totals[category]].sort((a, b) => a[1] === b[1] ? compareText(a[0], b[0]) : a[1] > b[1] ? -1 : 1)
      .slice(0, 3).map(([recipient, score], index) => ({ rank:index + 1, wallet:recipient,
        ...(commonUsd?{scoreUsdMicros:String(score)}:{scoreLamports:String(score)}),
        percentOfCategory:DAILY_BONUS_POLICY.rankPercents[index], bonusLamports:'0' }))]));
  const excluded = [...new Set(excludedCollectionSignatures)].sort();
  if (excluded.some(id=>!fees.some(row=>row.signature === id))) throw new Error('Excluded bonus source is outside the verified window.');
  const sources = fees.filter(row => !excluded.includes(row.signature) && row.dailyBonusVersion === 1 && amount(row.communityLamports) > 0n)
    .map(row => allocateDailyBonusSource(row,rankings));
  const basePolicy={...DAILY_BONUS_POLICY};
  // Snapshots predating this rule must reproduce their original policy and hash.
  if(traderEligibility==='all-wallets-v1')delete basePolicy.traderEligibility;
  const policy=commonUsd?{...basePolicy,scoringBasis,metrics:{creators:'settled-creator-fee-usd-micros',
    referrals:'direct-referred-settled-fee-usd-micros',traders:'finalized-trading-volume-usd-micros'},
    ...(settlementTime?{eligibilityBasis}:{})}:settlementTime?{...basePolicy,eligibilityBasis,metrics:{...basePolicy.metrics,
    creators:'settled-creator-fee-lamports',referrals:'direct-referred-settled-fee-lamports'}}:basePolicy;
  const snapshot = { version:1, ...window, ...bonusSnapshotIdentity(cluster,programId,window), ...(settlementTime?{eligibilityBasis}:{}), policy:window.qa ? { ...policy, periodSeconds:300, qa:true } : policy, rankings, sources,
    evidence:{ collections:fees, trades:events, coverage:[...coverage].sort((a, b) => compareText(a.mint, b.mint)),
      ...(excluded.length ? { excludedCollectionSignatures:excluded } : {}) } };
  return { ...snapshot, hash:bonusHash(snapshot) };
}
export function dailyBonusManifest(snapshot, source) {
  if (!source.allocations.length) return null;
  // A paired-token collection must be converted and independently proved as
  // SOL funding before it can become a source. Token units are never a payout.
  const budget = amount(source.amountLamports);
  const payable = source.allocations.reduce((sum, row) => sum + amount(row.amount), 0n);
  if (payable !== amount(source.payableLamports) || payable + amount(source.retainedLamports) !== budget)
    throw new Error('Daily bonus source is not an exact SOL lamport allocation.');
  const cycleId = createRewardCycleId({ mint:source.mint,
    kind:`daily-bonus-v1:${source.collectionSignature}`, asset:DAILY_BONUS_PAYOUT_ASSET,
    periodStart:snapshot.start, periodEnd:snapshot.end });
  return buildRewardManifest({ cycleId, asset:DAILY_BONUS_PAYOUT_ASSET, allocations:source.allocations });
}
