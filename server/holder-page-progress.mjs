// Offline durable state machine. No RPC, signer, transaction sender or scheduler import.
import { assertHolderPagePlan } from './holder-page-plan.mjs';

const copy = value => structuredClone(value);
const pageAt = (plan, index) => {
  if (!Number.isSafeInteger(index) || !plan.pages[index]) throw new Error('Unknown page.');
  return plan.pages[index];
};
const validAttempt = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const RECEIPT_FACTS = ['digest', 'cycleId', 'asset', 'root', 'index', 'recipient', 'amount',
  'signature', 'finalized', 'balanceDeltaVerified', 'executedAt'];
const sameReceiptFacts = (prior, receipt) => RECEIPT_FACTS.every(key => prior[key] === receipt[key]);
function checkReceipt(plan, page, progress, receipt) {
  const leaf = page.leaves.find(item => item.index === receipt?.index);
  if (!leaf || receipt.cycleId !== plan.cycleId || receipt.asset !== plan.asset
    || receipt.root !== plan.root || receipt.digest !== plan.digest
    || receipt.recipient !== leaf.recipient || receipt.amount !== leaf.amount
    || receipt.finalized !== true || receipt.balanceDeltaVerified !== true
    || typeof receipt.signature !== 'string' || !receipt.signature.length
    || !Number.isSafeInteger(receipt.executedAt) || receipt.executedAt < progress.startedAt
    || receipt.executedAt >= plan.expiresAt) throw new Error('Receipt does not match immutable entitlement.');
}
function checkProgress(row) {
  const identities = {}, attempts = new Set();
  for (const [index, progress] of Object.entries(row.pages)) {
    const page = pageAt(row.plan, Number(index));
    if (String(page.index) !== index || !validAttempt(progress.attemptId) || attempts.has(progress.attemptId)
      || !Number.isSafeInteger(progress.startedAt) || progress.startedAt < 0
      || progress.startedAt >= row.plan.expiresAt || !['pending', 'finalized'].includes(progress.status))
      throw new Error('Invalid persisted page progress.');
    attempts.add(progress.attemptId);
    for (const [key, receipt] of Object.entries(progress.paid)) {
      checkReceipt(row.plan, page, progress, receipt);
      if (String(receipt.index) !== key) throw new Error('Invalid persisted receipt index.');
      identities[receipt.signature + ':' + receipt.index] = page.index;
    }
    if ((Object.keys(progress.paid).length === page.leaves.length) !== (progress.status === 'finalized'))
      throw new Error('Incomplete persisted page finalization.');
  }
  if (Object.keys(identities).length !== Object.keys(row.receipts).length
    || Object.entries(identities).some(([key, index]) => row.receipts[key] !== index))
    throw new Error('Persisted receipt identity mismatch.');
}

export function createHolderPageProgress({ store, plan }) {
  assertHolderPagePlan(plan);
  // Detach caller-owned objects before the first await.
  plan = copy(plan);
  const transaction = mutator => store.transaction(state => {
    state.holderPagePlans ||= {};
    const prior = state.holderPagePlans[plan.cycleId];
    if (prior && prior.plan.digest !== plan.digest) throw new Error('Immutable cycle already has another plan.');
    const row = prior || { plan:copy(plan), pages:{}, receipts:{} };
    assertHolderPagePlan(row.plan);
    checkProgress(row);
    const result = mutator(row);
    checkProgress(row);
    state.holderPagePlans[plan.cycleId] = row;
    return copy(result);
  });
  return {
    initialize:() => transaction(row => ({ digest:row.plan.digest, pages:plan.pages.length })),
    status:() => transaction(row => {
      const paid = Object.values(row.pages).reduce((sum, page) => sum
        + Object.values(page.paid || {}).reduce((total, receipt) => total + BigInt(receipt.amount), 0n), 0n);
      const complete = plan.pages.every(page => row.pages[page.index]?.status === 'finalized');
      return { digest:plan.digest, complete, paid:String(paid),
        outstanding:String(BigInt(plan.allocated) - paid), retainedDust:plan.retainedDust,
        pages:row.pages };
    }),
    begin:({ index, attemptId, now, paused, solvent }) => transaction(row => {
      const page = pageAt(plan, index);
      if (!validAttempt(attemptId)) throw new Error('Invalid attempt identity.');
      const prior = row.pages[index];
      if (prior?.status === 'finalized') return { status:'finalized', index };
      // An unknown submission never expires into permission to resubmit.
      if (prior) throw new Error('Pending attempt requires finalized reconciliation; no retry permitted.');
      if (!Number.isSafeInteger(now) || now < 0 || now >= plan.expiresAt) throw new Error('Expired or invalid plan time.');
      if (paused !== false || solvent !== true) throw new Error('Pause and solvency clearance required.');
      if (Object.values(row.pages).some(item => item.attemptId === attemptId)) throw new Error('Attempt identity already used.');
      row.pages[index] = { status:'pending', attemptId, startedAt:now, paid:{} };
      return { status:'pending', digest:plan.digest, page:copy(page), attemptId };
    }),
    // Only a future exact-program verifier may supply these records. This module
    // does not authenticate receipts and cannot authorize or prove a chain payout.
    reconcile:({ index, attemptId, receipts }) => transaction(row => {
      const page = pageAt(plan, index), progress = row.pages[index];
      if (!progress || progress.attemptId !== attemptId) throw new Error('Unknown or stale attempt.');
      if (!Array.isArray(receipts) || !receipts.length || receipts.length > page.leaves.length) throw new Error('Invalid receipt page.');
      const seen = new Set();
      for (const receipt of receipts) {
        checkReceipt(plan, page, progress, receipt);
        if (seen.has(receipt.index)) throw new Error('Duplicate receipt index.');
        seen.add(receipt.index);
        const identity = receipt.signature + ':' + receipt.index;
        if (row.receipts[identity] !== undefined && row.receipts[identity] !== index) throw new Error('Receipt replay.');
        const prior = progress.paid[receipt.index];
        if (prior && !sameReceiptFacts(prior, receipt)) throw new Error('Conflicting finalized receipt.');
        // Preserve the original record for a semantically identical duplicate.
        progress.paid[receipt.index] ||= copy(receipt);
        row.receipts[identity] = index;
      }
      if (Object.keys(progress.paid).length === page.leaves.length) progress.status = 'finalized';
      return { status:progress.status, paid:Object.keys(progress.paid).length };
    }),
  };
}
