import { verifiedTradeReceipt } from './trade-share-proof.js';

export function assessTradeCompletion({ transaction, marketActivity, wallet, mint, side, signature }) {
  const receiptVerified = verifiedTradeReceipt(transaction, { wallet, mint, side, signature });
  const indexed = marketActivity?.cluster === 'devnet'
    && marketActivity?.mint === mint
    && marketActivity?.source === 'confirmed-pump-trade-events'
    && Array.isArray(marketActivity.recentTrades)
    && marketActivity.recentTrades.some(row => row.signature === signature && row.trader === wallet && row.side === side);
  return { receiptVerified, indexed: Boolean(indexed), complete: receiptVerified && Boolean(indexed) };
}
