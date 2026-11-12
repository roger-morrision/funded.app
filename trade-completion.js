import { verifiedTradeReceipt } from './trade-share-proof.js';
import { APP_NET } from './src/features/shared/app-network.js';

export function assessTradeCompletion({ transaction, marketActivity, wallet, mint, side, signature }) {
  const receiptVerified = verifiedTradeReceipt(transaction, { wallet, mint, side, signature });
  const indexed = marketActivity?.cluster === 'devnet'
    && marketActivity?.mint === mint
    && marketActivity?.source === 'confirmed-pump-trade-events'
    && Array.isArray(marketActivity.recentTrades)
    && marketActivity.recentTrades.some(row => row.signature === signature && row.trader === wallet && row.side === side);
  // Mainnet has no app trade indexer: the finalized balance-change receipt completes the trade.
  return { receiptVerified, indexed: Boolean(indexed), complete: receiptVerified && (Boolean(indexed) || APP_NET === 'mainnet-beta') };
}
