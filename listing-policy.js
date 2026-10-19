import { currentServiceFees } from './service-fees.js';
export let LISTING_PRICE_USD = currentServiceFees().listingUsd;
export function setListingPriceUsd(usd) { if (!Number.isInteger(usd) || usd < 1 || usd > 100_000) throw new Error('Invalid listing price.'); LISTING_PRICE_USD = usd; }
export const LISTING_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const LISTING_MEMO_PREFIX = 'funded.vip:list:';

export function listingMemo(mint) {
  return `${LISTING_MEMO_PREFIX}${mint}`;
}

export function listingBurnTokens(tokenPriceUsd, usd = LISTING_PRICE_USD) {
  const price = Number(tokenPriceUsd);
  if (!Number.isFinite(price) || price <= 0) throw new Error('A verified $FUNDED/USD price is required.');
  const amount = Math.ceil(usd / price);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('The listing price cannot be converted to a safe token amount.');
  return amount;
}

export function listingBurnBaseUnitsForUsd(tokenPriceUsd, decimals, usd = LISTING_PRICE_USD) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Unsupported $FUNDED mint decimals.');
  const price = Number(tokenPriceUsd);
  if (!Number.isFinite(price) || price <= 0) throw new Error('A verified $FUNDED/USD price is required.');
  const units = Math.ceil((usd / price) * (10 ** decimals));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('The listing cannot be represented safely at this token price.');
  return BigInt(units);
}

export function listingQuoteCurrent(quote, { mint, payer, fundedMint, now = Date.now(), usd = LISTING_PRICE_USD } = {}) {
  const created = Date.parse(quote?.createdAt);
  const expires = Date.parse(quote?.expiresAt);
  return /^listing_\d+_[0-9a-f]{16}$/.test(String(quote?.id || ''))
    && quote.usd === usd && Number.isInteger(usd) && usd > 0 && Number.isFinite(quote.amountTokens) && quote.amountTokens > 0
    && Number.isInteger(quote.decimals) && quote.decimals >= 0 && quote.decimals <= 18
    && /^\d+$/.test(String(quote.amountBaseUnits || '')) && BigInt(quote.amountBaseUnits) > 0n
    && (!mint || quote.mint === mint) && (!payer || quote.payer === payer)
    && (!fundedMint || quote.fundedMint === fundedMint)
    && Number.isFinite(created) && created <= now && Number.isFinite(expires) && expires > now;
}

export function listingBurnBaseUnits(decimals, amountTokens) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Unsupported $FUNDED mint decimals.');
  if (!Number.isSafeInteger(amountTokens) || amountTokens <= 0) throw new Error('Unsupported Solana listing burn amount.');
  const baseUnits = BigInt(amountTokens) * 10n ** BigInt(decimals);
  if (baseUnits > 18446744073709551615n) throw new Error('The listing burn exceeds the SPL token amount limit.');
  return baseUnits;
}
