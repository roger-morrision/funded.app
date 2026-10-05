export const LISTING_BURN_TOKENS = 25_000n;
export const LISTING_DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const LISTING_MEMO_PREFIX = 'funded.vip:list:';

export function listingMemo(mint) {
  return `${LISTING_MEMO_PREFIX}${mint}`;
}

export function listingBurnBaseUnits(decimals, amountTokens = LISTING_BURN_TOKENS) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Unsupported $FUNDED mint decimals.');
  const amount = BigInt(amountTokens);
  if (amount <= 0n || amount > LISTING_BURN_TOKENS) throw new Error('Unsupported test network listing burn amount.');
  return amount * 10n ** BigInt(decimals);
}
