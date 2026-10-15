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
