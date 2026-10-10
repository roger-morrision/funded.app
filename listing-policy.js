export const LISTING_PRICE_USD = 200;
export const LISTING_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const LISTING_MEMO_PREFIX = 'funded.vip:list:';

export function listingMemo(mint) {
  return `${LISTING_MEMO_PREFIX}${mint}`;
}

export function listingBurnTokens(tokenPriceUsd) {
  const price = Number(tokenPriceUsd);
  if (!Number.isFinite(price) || price <= 0) throw new Error('A verified $FUNDED/USD price is required.');
  const amount = Math.ceil(LISTING_PRICE_USD / price);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('The listing price cannot be converted to a safe token amount.');
  return amount;
}

export function listingBurnBaseUnitsForUsd(tokenPriceUsd, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Unsupported $FUNDED mint decimals.');
  const price = Number(tokenPriceUsd);
  if (!Number.isFinite(price) || price <= 0) throw new Error('A verified $FUNDED/USD price is required.');
  const units = Math.ceil((LISTING_PRICE_USD / price) * (10 ** decimals));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('The $200 listing cannot be represented safely at this token price.');
  return BigInt(units);
}

export function listingQuoteCurrent(quote, { mint, payer, fundedMint, now = Date.now() } = {}) {
  const created = Date.parse(quote?.createdAt);
  const expires = Date.parse(quote?.expiresAt);
  return /^listing_\d+_[0-9a-f]{16}$/.test(String(quote?.id || ''))
    && quote.usd === LISTING_PRICE_USD && Number.isFinite(quote.amountTokens) && quote.amountTokens > 0
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
