// A planning allowance for new Solana accounts, transaction fees, and rent.
// The connected-wallet simulation replaces this allowance before signing.
export const PUBLIC_LAUNCH_OVERHEAD_ALLOWANCE_LAMPORTS = 50_000_000n;
const exactLamports = value => typeof value === 'bigint'
  || typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
  || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function publicLaunchBudget(quote, launchFeeLamports) {
  if (quote?.status !== 'ready') return null;
  if (typeof launchFeeLamports !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(launchFeeLamports)) return null;
  if (!exactLamports(quote.solAmountLamports) || !exactLamports(quote.maxSolAmountLamports)) return null;
  let purchase, maximum, serviceFee;
  try {
    purchase = BigInt(quote.solAmountLamports);
    maximum = BigInt(quote.maxSolAmountLamports);
    serviceFee = BigInt(launchFeeLamports);
  } catch { return null; }
  if (purchase <= 0n || maximum < purchase || serviceFee > 5_000_000_000n) return null;
  const allowance = maximum - purchase;
  const overhead = PUBLIC_LAUNCH_OVERHEAD_ALLOWANCE_LAMPORTS;
  const total = maximum + overhead + serviceFee;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { purchase, allowance, overhead, serviceFee, total };
}
