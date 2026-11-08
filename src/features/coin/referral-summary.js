// Reuse the finalized recipient proofs shown in Payment history. Allocations and
// submitted transactions are not payments; unknown coverage must not become zero.
export function coinReferralSummary(history, mint, cluster) {
  const missing = {amountLamports:null, count:0, partial:false};
  if (history?.cluster !== cluster || history.commitment !== 'finalized'
    || !['onchain-indexed','partial'].includes(history.status)
    || !['verified','partial'].includes(history.payoutCoverage?.status)
    || !Array.isArray(history.verifiedPayouts)) return missing;
  const partial = history.status === 'partial' || history.payoutCoverage.status === 'partial';
  const seen = new Set();
  let total = 0n;
  for (const row of history.verifiedPayouts) {
    if (row.mint !== mint || row.source !== 'v3-referral') continue;
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature || '')
      || !/^(0|[1-9]\d*)$/.test(String(row.actualReceivedLamports))
      || String(row.actualReceivedLamports) !== String(row.amountLamports)) return missing;
    if (seen.has(row.signature)) continue;
    seen.add(row.signature);
    total += BigInt(row.actualReceivedLamports);
  }
  return {amountLamports:partial && !seen.size ? null : total.toString(), count:seen.size, partial};
}
