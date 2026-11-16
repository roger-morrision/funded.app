// Keeps holder-payout readiness fresh while a long holder-indexing tick runs.
// It only re-confirms an already healthy status against the chain; a failed
// check marks it unavailable, and indexing failures recorded by a tick are kept.
export async function rewardHeartbeat({ store, chain }, at = new Date()) {
  const ready = await chain.readiness().catch(error => ({ constrainedPayouts:false, reasons:[String(error.message || error).slice(0, 180)] }));
  await store.transaction(state => {
    const prior = state.serviceStatus;
    if (ready.constrainedPayouts === true) { if (prior?.constrainedPayouts === true) prior.checkedAt = at.toISOString(); return; }
    state.serviceStatus = { constrainedPayouts:false, reasons:ready.reasons || [], reason:`On-chain automatic payout is unavailable: ${(ready.reasons || []).join(', ')}`, checkedAt:at.toISOString() };
  });
  return ready.constrainedPayouts === true;
}
