// A planning allowance for new Solana accounts, transaction fees, and rent.
// The connected-wallet simulation replaces this allowance before signing.
export const PUBLIC_LAUNCH_OVERHEAD_ALLOWANCE_LAMPORTS = 50_000_000n;

export function publicLaunchBudget(quote) {
  if (quote?.status !== 'ready') return null;
  let purchase, maximum;
  try {
    purchase = BigInt(quote.solAmountLamports);
    maximum = BigInt(quote.maxSolAmountLamports);
  } catch { return null; }
  if (purchase <= 0n || maximum < purchase) return null;
  const allowance = maximum - purchase;
  const overhead = PUBLIC_LAUNCH_OVERHEAD_ALLOWANCE_LAMPORTS;
  const total = maximum + overhead;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { purchase, allowance, overhead, total };
}
