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
