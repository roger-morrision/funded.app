// Reward cycles that can never be fully paid release their unpaid commitment
// on-chain (expire_reward_cycle) once the program's grace period has passed.

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

// After the program's grace period, release the unpaid commitment of a cycle
// that can never be fully paid so the vault can fund later periods.
export async function expireUnpayableCycles({ store, chain, now, selected = null }) {
  if (typeof chain.expireCycle !== 'function') return 0;
  const grace = Number(chain.cycleExpiryGraceSeconds);
  if (!Number.isSafeInteger(grace) || grace <= 0) return 0;
  const rows = await store.transaction(state => structuredClone(Object.values(state.schedules || {}).filter(row =>
    unpayableCycleSchedule(row) && now >= row.payoutAt + grace && (selected === null || selected.has(row.id)))));
  let expired = 0;
  for (const row of rows) {
    try {
      const result = await chain.expireCycle(row);
      await store.transaction(state => Object.assign(state.schedules[row.id], { status:'expired',
        reason:'Unpayable reward cycle expired on-chain; its unpaid amount stays in the vault for later periods.',
        expiredUnpaidAmount:result.unpaidAmount, expirySignature:result.signature || null, expiredAt:new Date().toISOString() }));
      expired += 1;
    } catch (error) {
      await store.transaction(state => { state.schedules[row.id].expiryError = String(error.message || error).slice(0, 180); });
    }
  }
  return expired;
}
