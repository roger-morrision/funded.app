import { currentServiceFees } from './service-fees.js';
export const LAUNCH_TIER_USD = Object.freeze({ get pro() { return currentServiceFees().proUsd; }, get premier() { return currentServiceFees().premierUsd; } });

export function launchTierAmounts(tokenPriceUsd, fees = currentServiceFees()) {
  const price = Number(tokenPriceUsd);
  if (!Number.isFinite(price) || price <= 0) throw new Error('A positive $FUNDED/USD price is required.');
  const amounts = { pro:Math.ceil(fees.proUsd/price), premier:Math.ceil(fees.premierUsd/price) };
  if (Object.values(amounts).some(amount => !Number.isSafeInteger(amount) || amount <= 0))
    throw new Error('The $FUNDED price cannot be converted to a safe token amount.');
  return amounts;
}

export function launchTierQuoteCurrent(quote, { tier, payer, mint, now = Date.now() } = {}) {
  if (!quote || !Object.hasOwn(LAUNCH_TIER_USD, quote.tier)) return false;
  if (tier && quote.tier !== tier) return false;
  if (payer && quote.payer !== payer) return false;
  if (mint && quote.fundedMint !== mint) return false;
  const created = Date.parse(quote.createdAt);
  const expires = Date.parse(quote.expiresAt);
  return /^launch_tier_\d+_[0-9a-f]{16}$/.test(String(quote.id || ''))
    && Number.isSafeInteger(quote.amountTokens) && quote.amountTokens > 0
    && quote.usd === LAUNCH_TIER_USD[quote.tier]
    && Number.isFinite(created) && created <= now && Number.isFinite(expires) && expires > now;
}
