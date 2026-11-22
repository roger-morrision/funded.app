// Reward cycles that can never be fully paid release their unpaid commitment
// on-chain (expire_reward_cycle) once the program's grace period has passed.
import {expiryPlanHash} from './reward-expiry-attempt.mjs';

const PROTOCOL_OWNED_MANIFEST = /protocol-owned vault or PumpSwap liquidity pool/;
const UNPAYABLE_LEAF = /TokenOwnerOffCurve/;

// A committed cycle is unpayable when its manifest was blocked for a protocol-owned
// leaf, or when every unpaid leaf failed because its owner cannot hold a token account.
export function unpayableCycleSchedule(row) {
  if (!row?.cycle || !['blocked', 'distributing'].includes(row.status) || !Array.isArray(row.manifest?.leaves)) return false;
  if (row.status === 'blocked' && PROTOCOL_OWNED_MANIFEST.test(String(row.reason || ''))) return true;
  const unpaid = row.manifest.leaves.filter(leaf => row.payments?.[leaf.recipient]?.status !== 'paid');
  return unpaid.length > 0 && unpaid.every(leaf => row.payments?.[leaf.recipient]?.status === 'verification-pending'
    && UNPAYABLE_LEAF.test(String(row.payments[leaf.recipient].reason || '')));
}

// Release unpaid commitments after grace while preserving original custody.
export async function expireUnpayableCycles({ store, chain, now, selected = null, recoveryOnly = false, skipSavedAttempts = false }) {
  if (typeof chain.expireCycle !== 'function') return 0;
  const grace = Number(chain.cycleExpiryGraceSeconds);
  if (!recoveryOnly && (!Number.isSafeInteger(grace) || grace <= 0)) return 0;
  const rows = await store.transaction(state => structuredClone(Object.values(state.schedules || {}).filter(row =>
    (selected === null || selected.has(row.id)) && (recoveryOnly ? row.expiryAttempt && row.status !== 'expired'
      : unpayableCycleSchedule(row) && now >= row.payoutAt + grace && (!skipSavedAttempts || !Object.hasOwn(row,'expiryAttempt'))))));
  let expired = 0;
  for (const row of rows) {
    try {
      const result = await chain.expireCycle(row,{store,recoveryOnly});
      if(result?.expired!==true||result.expiryTransactionVerified!==true)
        throw new Error('Expiry needs attributed finalized transaction reconciliation; no new attempt authorized.');
      await store.transaction(state => {
        const saved=state.schedules?.[row.id];
        if(!saved||expiryPlanHash(saved)!==expiryPlanHash(row)||saved.expiryAttempt?.state!=='verified'
          ||saved.expiryAttempt.signature!==result.signature)throw new Error('Expiry schedule changed before attributed completion.');
        Object.assign(saved, { status:'expired',
        reason:'Unpayable cycle liability released; funds remain in the original vault and need custody reconciliation before reuse.',
        expiryVault:result.vault || null, expiryOriginalAuthority:result.originalAuthority || null,
        expiredUnpaidAmount:result.unpaidAmount, expirySignature:result.signature || null, expiredAt:new Date().toISOString() });
      });
      expired += 1;
    } catch (error) {
      await store.transaction(state => {
        const saved=state.schedules?.[row.id];
        if(saved&&expiryPlanHash(saved)===expiryPlanHash(row)){
          if(recoveryOnly&&!Object.hasOwn(saved,'expiryAttempt'))saved.expiryAttempt=structuredClone(row.expiryAttempt);
          saved.expiryError=String(error.message||error).slice(0,180);
        }
      });
    }
  }
  return expired;
}
