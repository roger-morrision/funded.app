// Pending transactions are visible even before the server has a confirmed receipt.
export function boostHistoryRows(history, pending, mint, now = Date.now()) {
  const rows = Array.isArray(history) ? history.filter(row => row?.mint === mint && row.signature) : [];
  const seen = new Set();
  const result = [];
  if (pending?.pendingSignature && pending.quote?.mint === mint && !rows.some(row => row.signature === pending.pendingSignature && row.status === 'finalized')) {
    result.push({ signature:pending.pendingSignature, packageId:pending.packageId || pending.quote.packageId,
      state:pending.failureProof ? 'Failed' : 'Awaiting confirmation', pending:true });
    seen.add(pending.pendingSignature);
  }
  for (const row of rows) {
    if (seen.has(row.signature)) continue;
    seen.add(row.signature);
    result.push({ ...row, state:row.status === 'failed' ? 'Failed' : row.status !== 'finalized' ? 'Awaiting confirmation'
      : !Number.isFinite(Date.parse(row.expiresAt)) ? 'Confirmed' : Date.parse(row.expiresAt) <= now ? 'Expired' : 'Active', pending:row.status !== 'finalized' && row.status !== 'failed' });
  }
  return result.slice(0, 10);
}
