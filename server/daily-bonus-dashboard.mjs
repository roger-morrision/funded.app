import { DAILY_BONUS_POLICY as POLICY } from '../config/daily-bonus.js';
import { splitBonusLamports, bonusHash } from './daily-bonus.mjs';
import { dailyBonusPayments } from '../src/features/fees/daily-bonus-payments.js';
import { DEVNET_GENESIS_HASH } from './automatic-reward-chain.mjs';
import { verifyV3PumpCollection } from './v3-collection-proof.mjs';
import { loadFinalizedV3Settlement } from './v3-settlement-proof.mjs';

const integer = value => /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : null;
const categories = POLICY.categories;

// Reproduce the immutable source allocation, including lamport rounding.
export function bonusSourceAwards(snapshot, source, wallet) {
  const budget = integer(source.amountLamports);
  if (budget == null) return null;
  const groups = splitBonusLamports(budget, POLICY.categoryWeights);
  return categories.map((category, index) => {
    const winner = snapshot.rankings?.[category]?.find(row => row.wallet === wallet);
    return winner && [1, 2, 3].includes(winner.rank)
      ? splitBonusLamports(groups[index], POLICY.rankPercents)[winner.rank - 1] : 0n;
  });
}

function attributeNet(net, weights) {
  const total = weights.reduce((a, b) => a + b, 0n);
  if (!total) return null;
  const values = weights.map(weight => net * weight / total);
  let dust = net - values.reduce((a, b) => a + b, 0n);
  const order = weights.map((weight, index) => ({ index, remainder:net * weight % total }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) if (dust-- > 0n) values[row.index]++;
  return values;
}

export function bonusDashboardHistory(ledger, { category = 'all', page = 1, pageSize = 20 } = {}) {
  if (!['all', ...categories].includes(category)) throw new Error('Unknown bonus category.');
  page = Math.max(1, Number.isSafeInteger(page) ? page : 1);
  pageSize = Math.min(50, Math.max(1, Number.isSafeInteger(pageSize) ? pageSize : 20));
  const aliases = new Map(), sources = []; let unavailableSnapshots = 0;
  for (const row of Object.values(ledger.dailyBonusSnapshots || {})) {
    const snapshot = row.snapshot;
    if (!snapshot || snapshot.version !== 1 || snapshot.policy?.version !== 1) { unavailableSnapshots++; continue; }
    const { hash, ...frozen } = snapshot;
    if (hash !== bonusHash(frozen)) { unavailableSnapshots++; continue; }
    for (const source of snapshot.sources || []) {
      const payments = row.payouts?.[source.collectionSignature]?.payments || {};
      sources.push({ payments, snapshotDay:snapshot.day });
      for (const [wallet, payment] of Object.entries(payments)) {
        const context = { snapshot, source, wallet, payment };
        for (const key of [payment.signature && `tx:${wallet}:${payment.signature}`, payment.payment && `account:${wallet}:${payment.payment}`].filter(Boolean)) {
          if (!aliases.has(key)) aliases.set(key, []);
          aliases.get(key).push(context);
        }
      }
    }
  }
  const totals = Object.fromEntries(categories.map(key => [key, new Map()]));
  const history = []; let unavailableReceipts = 0;
  for (const [wallet, result] of dailyBonusPayments({ sources })) {
    for (const receipt of result.receipts) {
      const matching = [...new Set([...(aliases.get(`tx:${wallet}:${receipt.signature}`) || []),
        ...(aliases.get(`account:${wallet}:${receipt.paymentAccount}`) || [])])];
      const fingerprints = new Set(matching.map(row => bonusHash({ day:row.snapshot.day,
        source:row.source.collectionSignature, amount:row.payment.amount,
        awards:bonusSourceAwards(row.snapshot, row.source, wallet)?.map(String) })));
      const context = matching[0], weights = context && bonusSourceAwards(context.snapshot, context.source, wallet);
      const gross = integer(context?.payment.amount);
      const savedAllocation = context?.source.allocations?.find(row => row.recipient === wallet);
      const attributable = fingerprints.size === 1 && weights && gross != null && integer(savedAllocation?.amount) === gross
        && weights.reduce((a, b) => a + b, 0n) === gross && receipt.receivedLamports != null;
      const amounts = attributable ? attributeNet(receipt.receivedLamports, weights) : null;
      if (!amounts) unavailableReceipts++;
      const awards = amounts ? Object.fromEntries(categories.map((key, index) => [key, String(amounts[index])])) : null;
      if (amounts) categories.forEach((key, index) => {
        if (!amounts[index]) return;
        const current = totals[key].get(wallet) || { wallet, receivedLamports:0n, payments:0 };
        current.receivedLamports += amounts[index]; current.payments++;
        totals[key].set(wallet, current);
      });
      history.push({ wallet, day:receipt.day, paidAt:receipt.paidAt, signature:receipt.signature,
        paymentAccount:receipt.paymentAccount, href:receipt.href,
        receivedLamports:receipt.receivedLamports == null ? null : String(receipt.receivedLamports),
        categoryLamports:awards, attribution:amounts ? 'proportional-net' : 'unavailable' });
    }
  }
  history.sort((a, b) => String(b.paidAt || b.day).localeCompare(String(a.paidAt || a.day))
    || String(a.signature || a.paymentAccount).localeCompare(String(b.signature || b.paymentAccount)));
  const filtered = category === 'all' ? history : history.filter(row => row.categoryLamports && BigInt(row.categoryLamports[category]) > 0n);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages);
  return { scope:'all-recorded-snapshots', snapshots:Object.keys(ledger.dailyBonusSnapshots || {}).length,
    unavailableReceipts, unavailableSnapshots, totalPayments:history.length,
    leaders:Object.fromEntries(categories.map(key => [key, [...totals[key].values()]
      .sort((a, b) => a.receivedLamports === b.receivedLamports ? a.wallet.localeCompare(b.wallet) : a.receivedLamports > b.receivedLamports ? -1 : 1)
      .slice(0, 10).map(row => ({ ...row, receivedLamports:String(row.receivedLamports) }))])),
    history:{ category, page, pages, total:filtered.length, rows:filtered.slice((page - 1) * pageSize, page * pageSize) } };
}

// Read only finalized indexed collections under a saved Daily bonus policy.
// This pool is an allocation, not a vault balance or a payment promise.
export async function readBonusPool({ state, connection, programId, now, signal,
  verifyCollection = verifyV3PumpCollection, loadSettlement = loadFinalizedV3Settlement }) {
  const start = Math.floor(now / 86_400) * 86_400;
  signal?.throwIfAborted();
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Bonus pool RPC is not Devnet.');
  const candidates = Object.values(state.collections || {}).filter(row => {
    const launch = state.launches?.[row.mint], settled = state.v3Settlements?.[row.signature];
    return row.scope === 'per-mint-v3' && row.cluster === 'devnet' && row.programId === programId
      && row.status === 'collected' && row.onchainVerified === true && row.attribution === 'mint-verified'
      && launch?.onchainVerified === true && launch.cluster === 'devnet'
      && launch.pumpFeeRoute?.programId === programId && launch.pumpFeeRoute?.verified === true
      && launch.feeDistribution?.fixedFunded?.communityRewards?.dailyBonus?.version === 1
      && settled?.status === 'finalized' && settled.blockTime >= start;
  });
  if (candidates.length > 2000) throw new Error('Bonus pool coverage requires a larger reviewed indexer.');
  const seen = new Set(), values = categories.map(() => 0n); let collections = 0;
  // Sequential bounded reads avoid overwhelming the shared RPC.
  for (const row of candidates) {
    signal?.throwIfAborted();
    if (seen.has(row.signature)) continue; seen.add(row.signature);
    const tx = await connection.getTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
    signal?.throwIfAborted();
    if (!tx || !Number.isSafeInteger(tx.blockTime)) throw new Error('Bonus collection proof is unavailable.');
    if (tx.blockTime < start || tx.blockTime >= start + 86_400 || tx.blockTime > now) continue;
    const launch = state.launches[row.mint], settled = state.v3Settlements[row.signature];
    const collected = await verifyCollection({ transaction:tx, signature:row.signature, programId,
      mint:row.mint, expectedLamports:row.collectedLamports });
    if (!collected) throw new Error('Bonus collection proof is unavailable.');
    signal?.throwIfAborted();
    const proof = await loadSettlement({ connection, signature:settled.settlementSignature, programId,
      mint:row.mint, authority:launch.pumpFeeRoute.initialAuthority, creator:launch.creatorWallet,
      claimId:collected.claimId, expectedLamports:row.collectedLamports, split:launch.pumpFeeRoute.protocolSplit });
    if (!proof || integer(proof.categoryLamports?.[5]) == null) throw new Error('Bonus settlement proof is unavailable.');
    const shares = splitBonusLamports(BigInt(proof.categoryLamports[5]), POLICY.categoryWeights);
    shares.forEach((value, index) => { values[index] += value; }); collections++;
  }
  return { status:'verified-indexed-settlements', day:new Date(start * 1000).toISOString().slice(0, 10),
    collections, categoryLamports:Object.fromEntries(categories.map((key, index) => [key, String(values[index])])) };
}
