const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function shouldAttemptV3Buyback(row, { triggerReached, retryAt = 0, now = Date.now() } = {}) {
  if (!['queued', 'verification-pending', 'awaiting-v3-buyback-executor',
    'verified-burn-residue'].includes(row?.status)) return false;
  if (['awaiting-v3-buyback-executor', 'verified-burn-residue'].includes(row.status)
    && triggerReached !== true) return false;
  if (!MINT.test(String(row.mint || ''))
    || !(SIGNATURE.test(String(row.sourceCollectionSignature || ''))
      || row.sourceCollectionSignature === 'onchain')) return false;
  return row.status === 'verification-pending' || now >= retryAt;
}
