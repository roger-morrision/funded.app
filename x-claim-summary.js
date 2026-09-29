const LAMPORTS_PER_SOL = 1_000_000_000;

function claimLamports(claim) {
  const amount = claim?.amountSol;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(lamports) || Math.abs(lamports / LAMPORTS_PER_SOL - amount) > 1e-9) return null;
  return BigInt(lamports);
}

function bucket() { return { count: 0, lamports: 0n, complete: true }; }

export function summarizeXClaims(claims) {
  if (!Array.isArray(claims)) return null;
  const summary = { total: bucket(), claimed: bucket(), unclaimed: bucket(), pending: bucket() };
  for (const claim of claims) {
    const group = claim?.receiptVerified === true ? 'claimed' : claim?.canPrepare === true ? 'unclaimed' : 'pending';
    const lamports = claimLamports(claim);
    for (const target of [summary.total, summary[group]]) {
      target.count += 1;
      if (lamports === null) target.complete = false;
      else target.lamports += lamports;
    }
  }
  return summary;
}

export function formatXClaimSol(bucket) {
  if (!bucket?.complete) return '—';
  const whole = bucket.lamports / BigInt(LAMPORTS_PER_SOL);
  const fraction = (bucket.lamports % BigInt(LAMPORTS_PER_SOL)).toString().padStart(9, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
}
