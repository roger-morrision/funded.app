const LAMPORTS_PER_SOL = 1_000_000_000;
export const TRADE_COST_ALLOWANCE_LAMPORTS = 5_000_000n;

export function buyRequiredLamports({ amountSol, slippagePercent, feeBps, trade = null }) {
  if (!Number.isFinite(amountSol) || amountSol <= 0 || !Number.isFinite(slippagePercent) || slippagePercent < 0.1 || slippagePercent > 10 || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 500) return null;
  const roundedLamports = Math.ceil(amountSol * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(roundedLamports)) return null;
  const amountLamports = BigInt(roundedLamports);
  const slippageBps = BigInt(Math.ceil(slippagePercent * 100));
  const maximumSpend = trade?.maximumInputAmount != null
    ? BigInt(trade.maximumInputAmount.toString())
    : amountLamports + (amountLamports * slippageBps + 9_999n) / 10_000n;
  const appFee = trade?.feeLamports != null
    ? BigInt(trade.feeLamports.toString())
    : (amountLamports * BigInt(feeBps) + 9_999n) / 10_000n;
  return maximumSpend + appFee + TRADE_COST_ALLOWANCE_LAMPORTS;
}

export function hasBuyBalance(balanceLamports, inputs) {
  const required = buyRequiredLamports(inputs);
  if (balanceLamports == null || required == null) return false;
  return BigInt(balanceLamports) >= required;
}
