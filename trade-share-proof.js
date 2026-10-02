export function verifiedTradeReceipt(transaction, { wallet, mint, side, signature }) {
  if (!transaction || transaction.meta?.err !== null || !['buy', 'sell'].includes(side) || !wallet || !mint || !signature) return false;
  const keys = transaction.transaction?.message?.accountKeys || [];
  const signed = keys.some(entry => String(entry.pubkey || entry) === wallet && entry.signer === true);
  if (!signed || !transaction.transaction?.signatures?.includes(signature)) return false;
  const amount = balances => (balances || []).filter(entry => entry.owner === wallet && entry.mint === mint)
    .reduce((total, entry) => total + BigInt(entry.uiTokenAmount?.amount || '0'), 0n);
  try {
    const delta = amount(transaction.meta.preTokenBalances) - amount(transaction.meta.postTokenBalances);
    return side === 'buy' ? delta < 0n : delta > 0n;
  } catch { return false; }
}
