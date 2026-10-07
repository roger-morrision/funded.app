import { payoutReceiptLamports } from './receipt-evidence.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function lamports(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) return null;
  const amount = BigInt(text);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount : null;
}

function result(rows, incomplete) {
  return {
    paidLamports: [...rows.values()].reduce((sum, amount) => sum + amount, 0n).toString(),
    payoutCount: rows.size,
    status: incomplete ? 'partial' : 'verified',
  };
}

// Automatic payments enter the ledger only after finalized reward-cycle and
// recipient/vault balance checks. Manual X payments also need a finalized RPC
// receipt; the recent receipt window may leave older manual claims unverified.
export function rewardPaidTotals(state = {}, rewards = null, evidence = {}, cluster = 'devnet') {
  if (!rewards?.schedules || typeof rewards.schedules !== 'object') {
    const unavailable = { paidLamports:null, payoutCount:null, status:'unavailable' };
    return { cluster, commitment:'finalized', holder:unavailable, x:{ ...unavailable } };
  }
  const holder = new Map(), x = new Map();
  let holderIncomplete = false, xIncomplete = false;
  for (const schedule of Object.values(rewards.schedules || {})) {
    if (!['holder', 'x'].includes(schedule?.kind) || schedule.asset !== 'SOL'
      || schedule.cluster && schedule.cluster !== cluster) continue;
    const rows = schedule.kind === 'holder' ? holder : x;
    for (const [wallet, payment] of Object.entries(schedule.payments || {})) {
      if (payment?.status !== 'paid') continue;
      const amount = lamports(payment.amount);
      if (!ADDRESS.test(wallet) || !SIGNATURE.test(String(payment.signature || ''))
        || payment.finalized !== true || payment.balanceDeltaVerified !== true || amount === null) {
        if (schedule.kind === 'holder') holderIncomplete = true;
        else xIncomplete = true;
        continue;
      }
      const key = `${payment.signature}:${wallet}`;
      if (rows.has(key) && rows.get(key) !== amount) {
        if (schedule.kind === 'holder') holderIncomplete = true;
        else xIncomplete = true;
      } else rows.set(key, amount);
    }
  }

  const evidenceReady = evidence.cluster === cluster && evidence.commitment === 'finalized'
    && ['onchain-indexed', 'partial', 'no-records'].includes(evidence.status);
  const xProofs = new Map((evidenceReady ? evidence.verifiedPayouts || [] : [])
    .filter(proof => proof.source === 'mint-router-settle-mint')
    .map(proof => [`${proof.signature}:${proof.to}`, proof]));
  for (const payout of Object.values(state.payouts || {})) {
    if (payout?.source !== 'mint-router-settle-mint' || payout.status !== 'paid'
      || payout.cluster !== cluster) continue;
    const amount = payoutReceiptLamports(payout);
    const proof = xProofs.get(`${payout.signature}:${payout.to}`);
    if (!proof || !SIGNATURE.test(String(payout.signature || '')) || !ADDRESS.test(String(payout.to || ''))
      || amount === null || proof.amountLamports !== amount
      || !Number.isSafeInteger(proof.actualReceivedLamports) || proof.actualReceivedLamports <= 0) {
      xIncomplete = true;
      continue;
    }
    const key = `${payout.signature}:${payout.to}`;
    const units = BigInt(amount);
    if (x.has(key) && x.get(key) !== units) xIncomplete = true;
    else x.set(key, units);
  }

  return { cluster, commitment:'finalized', holder:result(holder, holderIncomplete), x:result(x, xIncomplete) };
}
