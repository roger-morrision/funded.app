const asFinite = value => {
  if (value == null) return null;
  const number = Number(value.toString());
  return Number.isFinite(number) && number >= 0 ? number : null;
};

// The curve quote is an implied spot price, not an executable quote or USD value.
export function readCurveMetrics(curve, mint) {
  if (!curve || !mint) return { curvePriceSol: null, curveCapSol: null, curveReserveSol: null, curveProgressPercent: null };
  if (curve.complete) return { curvePriceSol: null, curveCapSol: null, curveReserveSol: null, curveProgressPercent: 100 };
  const virtualToken = asFinite(curve.virtualTokenReserves);
  const realToken = asFinite(curve.realTokenReserves);
  const virtualQuote = asFinite(curve.virtualQuoteReserves);
  const realQuote = asFinite(curve.realQuoteReserves);
  const supply = asFinite(mint.supply);
  const tokenScale = 10 ** mint.decimals;
  const curveProgressPercent = virtualToken > 0 && realToken != null
    ? Math.max(0, Math.min(100, (1 - realToken / virtualToken) * 100))
    : null;
  if (!Number.isFinite(tokenScale) || !virtualToken || virtualQuote == null || supply == null) {
    return { curvePriceSol: null, curveCapSol: null, curveReserveSol: realQuote == null ? null : realQuote / 1e9, curveProgressPercent };
  }
  const curvePriceSol = (virtualQuote / 1e9) / (virtualToken / tokenScale);
  const curveCapSol = curvePriceSol * (supply / tokenScale);
  return {
    curvePriceSol: Number.isFinite(curvePriceSol) ? curvePriceSol : null,
    curveCapSol: Number.isFinite(curveCapSol) ? curveCapSol : null,
    curveReserveSol: realQuote == null ? null : realQuote / 1e9,
    curveProgressPercent,
  };
}

// PumpSwap pool vault balances provide an indicative spot ratio. This is not an
// executable quote and intentionally excludes fees and price impact.
export function readPumpSwapMetrics({ baseAmount, quoteAmount, virtualQuoteAmount = 0, baseDecimals, quoteDecimals = 9, supply }) {
  const baseRaw = asFinite(baseAmount);
  const quoteRaw = asFinite(quoteAmount);
  const virtualQuoteRaw = asFinite(virtualQuoteAmount);
  const supplyRaw = asFinite(supply);
  const baseScale = 10 ** Number(baseDecimals);
  const quoteScale = 10 ** Number(quoteDecimals);
  if (!Number.isFinite(baseScale) || !Number.isFinite(quoteScale) || baseScale <= 0 || quoteScale <= 0) {
    return { poolPriceSol: null, poolMarketCapSol: null, poolReserveSol: null };
  }
  const poolReserveSol = quoteRaw == null ? null : quoteRaw / quoteScale;
  if (!baseRaw || quoteRaw == null || virtualQuoteRaw == null || supplyRaw == null) {
    return { poolPriceSol: null, poolMarketCapSol: null, poolReserveSol };
  }
  const poolPriceSol = ((quoteRaw + virtualQuoteRaw) / quoteScale) / (baseRaw / baseScale);
  const poolMarketCapSol = poolPriceSol * (supplyRaw / baseScale);
  return {
    poolPriceSol: Number.isFinite(poolPriceSol) ? poolPriceSol : null,
    poolMarketCapSol: Number.isFinite(poolMarketCapSol) ? poolMarketCapSol : null,
    poolReserveSol,
  };
}

export function formatSolMetric(value, { partial = false, digits = 6 } = {}) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  const number = Number(value);
  const formatted = number > 0 && number < 10 ** -digits
    ? number.toExponential(2)
    : number.toLocaleString(undefined, { maximumFractionDigits: digits });
  return `${partial ? '≥' : ''}${formatted} SOL`;
}
