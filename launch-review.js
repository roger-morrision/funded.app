export const LAUNCH_REVIEW_TTL_MS = 60_000;
const amount = value => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe launch amount.');
  const result = BigInt(value);
  if (result < 0n) throw new Error('Negative launch amount.');
  return result;
};

// Average curve price above its opening marginal price, excluding protocol fees.
// For a fresh constant-product curve: average/opening = T / (T - purchased).
export function initialCurvePremiumBps(purchased, virtualTokens) {
  const quantity = amount(purchased), reserves = amount(virtualTokens);
  if (!quantity) return 0;
  if (quantity >= reserves) throw new Error('Initial purchase exceeds curve reserves.');
  const bps = quantity * 10000n / (reserves - quantity);
  if (bps > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Curve premium is unavailable.');
  return Number(bps);
}

export function launchReview({ balance, simulatedSpend, networkFee, buyQuote = 0, buyMaximum = 0, transactionCount, curvePremiumBps = 0, now = Date.now() }) {
  const funds=amount(balance), spend=amount(simulatedSpend), fee=amount(networkFee), buy=amount(buyQuote), maximum=amount(buyMaximum);
  if (spend < buy + fee || maximum < buy || ![1,2].includes(transactionCount)) throw new Error('Launch cost breakdown could not be verified.');
  const allowance=maximum-buy, budget=spend+allowance;
  if (budget > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Launch budget exceeds safe precision.');
  return { simulatedSpend:spend.toString(), networkFee:fee.toString(), buyQuote:buy.toString(), buyMaximum:maximum.toString(),
    otherLaunchCosts:(spend-buy-fee).toString(), allowance:allowance.toString(), budget:budget.toString(),
    balanceAfterBudget:(funds-budget).toString(), sufficient:funds>=budget,
    transactionCount, messageCount:2, curvePremiumBps, quotedAt:now, expiresAt:now+LAUNCH_REVIEW_TTL_MS };
}
export function freshLaunchReview(review, now=Date.now()) {
  return Boolean(review && Number.isFinite(review.quotedAt) && Number.isFinite(review.expiresAt)
    && now >= review.quotedAt && now < review.expiresAt);
}
export function formatReviewSol(value) {
  const raw=BigInt(value),negative=raw<0n,absolute=negative?-raw:raw;
  const fraction=(absolute%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
  return `${negative?'-':''}${absolute/1000000000n}${fraction?'.'+fraction:''} SOL`;
}
export function launchReviewMarkup(review,now=Date.now()) {
  if(!freshLaunchReview(review,now))return 'Refresh the estimate to see the cost breakdown, approval count and remaining SOL.';
  const sol=formatReviewSol;
  return `<h3>Before you approve</h3><dl><dt>Initial purchase, including protocol fees</dt><dd>${sol(review.buyQuote)}</dd><dt>Purchase allowance (1%)</dt><dd>${sol(review.allowance)}</dd><dt>Network transaction fees</dt><dd>${sol(review.networkFee)}</dd><dt>Other simulated launch costs (including rent)</dt><dd>${sol(review.otherLaunchCosts)}</dd><dt>SOL budget estimate</dt><dd>${sol(review.budget)}</dd><dt>Wallet balance after this budget</dt><dd>${sol(review.balanceAfterBudget)}</dd></dl><p>${Number(review.transactionCount)} network transaction${review.transactionCount===1?'':'s'} and ${Number(review.messageCount)} message signatures (metadata and policy; no network fee for messages).</p><p>Average initial curve price: ${(Number(review.curvePremiumBps)/100).toFixed(2)}% above the opening price, excluding fees. This is price impact, not slippage or a price forecast.</p><p>Estimate valid for ${Math.max(0,Math.ceil((review.expiresAt-now)/1000))} more seconds. Wallet prompts show the actual transactions. A later transaction can fail after an earlier one succeeds.</p>`;
}
