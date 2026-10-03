import { createHash } from 'node:crypto';
import { AUTOMATIC_REWARDS } from '../automatic-rewards.js';
import { rewardServiceHealth } from './reward-service-health.mjs';

export function automaticRewardStatus(now = new Date(), state = {}) {
  const service = state.serviceStatus || {};
  const health = rewardServiceHealth(service, now.getTime());
  const active = health.healthy;
  const schedules = Object.values(state.schedules || {}).sort((a, b) => Number(b.periodStart) - Number(a.periodStart)).slice(0, 20).map(row => ({ id:row.id, mint:row.mint, asset:row.asset, kind:row.kind, periodStart:row.periodStart, cutoffAt:new Date(row.cutoffAt * 1000).toISOString(), payoutAt:new Date(row.payoutAt * 1000).toISOString(), status:row.status, reason:row.reason || null, recipientCount:row.manifest?.leaves?.length || 0, totalAmount:row.manifest?.totalAmount || null, paidCount:Object.values(row.payments || {}).filter(item => item.status === 'paid').length }));
  const blockedSchedules = schedules.filter(row => row.status === 'blocked').length;
  return { policy: AUTOMATIC_REWARDS, serverTime: now.toISOString(), status: active ? blockedSchedules ? 'degraded' : 'active' : 'unavailable', schedules,
    reason: active ? blockedSchedules ? `${blockedSchedules} reward schedule${blockedSchedules === 1 ? ' is' : 's are'} blocked; inspect each reason before promising a payout.` : null : health.reasons.includes('rpc-quota-exhausted')
      ? health.reasons.includes('worker-readiness-stale')
        ? 'The last reward-worker check failed because the Devnet RPC quota was exhausted. Reward readiness is stale until its next check.'
        : service.reason || 'Automatic distributions are unavailable because the Devnet RPC quota is exhausted.'
      : health.reasons.includes('worker-readiness-stale')
      ? 'Automatic distributions are unavailable because the reward worker has not reported readiness in over 3 minutes.'
      : service.reason || 'Automatic distributions are unavailable until the Devnet reward program and worker pass their constrained-payout readiness checks.',
    modes: { creator: 'wallet-requested-after-minimum', holders: 'automatic-SOL-or-token', x: 'unavailable', community: schedules.some(row => row.kind === 'community' && ['prepared', 'distributing', 'paid'].includes(row.status)) ? 'verified-token-airdrop-cycle' : 'awaiting-funded-migration-snapshot', referrals: 'manual-claim', buyback: 'accrual-only-execution-unavailable' } };
}

// The store must provide durable, exclusive transactions. The chain adapter must
// enforce each ID/recipient/amount on chain and verify finalized transfer deltas.
// No public API accepts obligations; only trusted settlement/indexing can enqueue.
export function createAutomaticRewardWorker({ store, chain }) {
  async function tick() {
    if (!chain || !(await chain.readiness()).constrainedPayouts) return { status: 'unavailable' };
    return store.transaction(async state => {
      state.obligations ||= {};
      state.batches ||= {};
      for (const batch of Object.values(state.batches)) {
        if (batch.status === 'paid') continue;
        const proof = await chain.lookup(batch);
        if (proof?.finalized && proof.id === batch.id && proof.recipient === batch.recipient && proof.asset === batch.asset && proof.amount === batch.amount && proof.signature && proof.balanceDeltaVerified) {
          batch.status = 'paid'; batch.signature = proof.signature;
          for (const id of batch.obligationIds) state.obligations[id].status = 'paid';
        }
      }
      const groups = new Map();
      for (const [keyId, obligation] of Object.entries(state.obligations)) {
        if (obligation.id !== keyId) throw new Error('Obligation key must match its immutable ID.');
        if (obligation.kind === 'referral' || obligation.status !== 'accrued' || !obligation.verified || !obligation.recipient) continue;
        if (!['creator', 'holder', 'x', 'community'].includes(obligation.kind)) continue;
        if (obligation.kind === 'x' && !obligation.identityVerified) continue;
        if (obligation.asset !== 'SOL') continue; // Token vault adapter is not deployed.
        if (!/^\d+$/.test(obligation.amount) || BigInt(obligation.amount) <= 0n) throw new Error('Invalid obligation amount.');
        const key = JSON.stringify([obligation.mint, obligation.recipient, obligation.asset]);
        const group = groups.get(key) || []; group.push(obligation); groups.set(key, group);
      }
      for (const group of groups.values()) {
        const amount = group.reduce((sum, item) => sum + BigInt(item.amount), 0n);
        if (amount < BigInt(AUTOMATIC_REWARDS.minimumLamports)) continue;
        const obligationIds = group.map(item => item.id).sort();
        if (new Set(obligationIds).size !== group.length || obligationIds.some(id => !id)) throw new Error('Invalid obligation IDs.');
        const id = createHash('sha256').update(JSON.stringify([group[0].mint, group[0].recipient, group[0].asset, obligationIds])).digest('hex');
        const batch = { id, mint: group[0].mint, recipient: group[0].recipient, asset: group[0].asset, amount: String(amount), obligationIds, status: 'prepared' };
        state.batches[id] = batch;
        group.forEach(item => { item.status = 'queued'; item.batchId = id; });
      }
      return { status: 'prepared' };
    });
  }
  // Persist before broadcasting. A timeout stays uncertain; it is never treated
  // as failure or retried with a new ID. Reconciliation occurs on the next tick.
  async function sendPrepared() {
    if (!chain || !(await chain.readiness()).constrainedPayouts) return { status: 'unavailable' };
    const batches = await store.transaction(state => {
      const ready = Object.values(state.batches || {}).filter(item => item.status === 'prepared');
      ready.forEach(item => { item.status = 'submitted'; });
      return structuredClone(ready);
    });
    for (const batch of batches) await chain.submit(batch).catch(() => {});
    return { status: 'awaiting-confirmation', submitted: batches.length };
  }
  return { tick, sendPrepared };
}
