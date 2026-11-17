// The trade estimate card already shows the amount received and the slippage
// minimum, so no extra plain-language sentence is added under it.
export function mountTradeSummary(document = globalThis.document) {
  document.getElementById('trade-plain-summary')?.remove();
  return Boolean(document.getElementById('trade-submit'));
}
