const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export const MIN_V3_BUYBACK_ORDER_LAMPORTS = 10_000n;
export function buybackOrderSizeSummary(rows) {
  let eligible=0n,dust=0n;
  for(const row of rows){
    if(!/^[1-9]\d*$/.test(String(row.amountLamports||'')))continue;
    const value=BigInt(row.amountLamports);
    if(value<MIN_V3_BUYBACK_ORDER_LAMPORTS)dust+=value;else eligible+=value;
  }
  return {orderSizeEligibleLamports:String(eligible),belowMinimumLamports:String(dust),
    executionRequiresFreshProof:true};
}

export function v3BuybackPendingStatus(order, remaining, fallback) {
  const status=order?.status || fallback;
  if (order?.signature && ['queued','verification-pending'].includes(status)) return 'verification-pending';
  if (order?.signature || status==='verification-pending') return status;
  return BigInt(remaining)<MIN_V3_BUYBACK_ORDER_LAMPORTS ? 'below-minimum-order' : status;
}

export function shouldAttemptV3Buyback(row, { triggerReached, retryAt = 0, now = Date.now() } = {}) {
  if (!['queued', 'verification-pending', 'awaiting-v3-buyback-executor',
    'verified-burn-residue'].includes(row?.status)) return false;
  if (['awaiting-v3-buyback-executor', 'verified-burn-residue'].includes(row.status)
    && triggerReached !== true && row.ageEligible!==true) return false;
  if (!MINT.test(String(row.mint || ''))
    || !(SIGNATURE.test(String(row.sourceCollectionSignature || ''))
      || ['onchain','aggregate'].includes(row.sourceCollectionSignature))) return false;
  if (row.status!=='verification-pending') {
    const amount=String(row.amountLamports ?? '');
    if (!/^[1-9]\d{0,15}$/.test(amount) || BigInt(amount)<MIN_V3_BUYBACK_ORDER_LAMPORTS
      || BigInt(amount)>BigInt(Number.MAX_SAFE_INTEGER)) return false;
  }
  return row.status === 'verification-pending' || now >= retryAt;
}
