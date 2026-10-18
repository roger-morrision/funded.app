// Keep small V3 SOL payouts exact in the dashboard and shared receipts.
export function formatReferralLamports(value) {
  const raw = String(value);
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw new Error('Invalid referral payout amount.');
  const lamports = BigInt(raw);
  const whole = lamports / 1_000_000_000n;
  const fraction = String(lamports % 1_000_000_000n).padStart(9, '0')
    .replace(/0+$/, '').padEnd(4, '0');
  return `${whole}.${fraction}`;
}

export function paidReferralLamports(claims) {
  if (!Array.isArray(claims)) return null;
  let total = 0n;
  for (const row of claims) {
    if (row?.asset !== 'SOL' || row.status !== 'paid') continue;
    if (!/^(0|[1-9]\d*)$/.test(String(row.amountLamports))) return null;
    total += BigInt(row.amountLamports);
  }
  return total;
}

// Validate the complete history before replacing any displayed payout total.
// A malformed amount is unavailable data, never a zero-lamport receipt.
export function readReferralHistory(claims) {
  if (!Array.isArray(claims)) return null;
  for (const row of claims) {
    if (!row || Array.isArray(row) || row.asset !== 'SOL'
      || !Number.isInteger(row.level) || row.level < 1 || row.level > 3
      || typeof row.status !== 'string' || !row.status) return null;
    const amount = row.amountLamports;
    if (!['string','number','bigint'].includes(typeof amount)
      || (typeof amount === 'number' && !Number.isSafeInteger(amount))
      || !/^(0|[1-9]\d{0,19})$/.test(String(amount))) return null;
    const lamports = BigInt(amount);
    if (lamports > 0xffffffffffffffffn || (row.status === 'paid'
      && (lamports === 0n || typeof row.payoutSignature !== 'string' || !row.payoutSignature))) return null;
  }
  return { claims, paidLamports:paidReferralLamports(claims) };
}
