import { formatTokenBaseAmount } from '../../../trade-panel-balance.js';
// Read-only fee estimation for the exact prepared instruction set. The wallet shows final costs.
export async function estimateTradeNetworkFee(app, trade) {
  let timer;
  try {
    return await Promise.race([(async () => {
      const connection = await app.getTradePreviewConnection();
      if (typeof connection.getFeeForMessage !== 'function') return null;
      const { Transaction } = await app.getSolana();
      const latest = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({feePayer:trade.user, recentBlockhash:latest.blockhash}).add(...trade.instructions);
      const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
      return Number.isSafeInteger(fee?.value) && fee.value >= 0 ? String(fee.value) : null;
    })(), new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
export function renderTradeCostDisclosure(dialog, trade, fee) {
  let row = dialog.querySelector('[data-trade-costs]');
  if (!row) { row = document.createElement('p'); row.dataset.tradeCosts = ''; row.className = 'flow-note'; dialog.querySelector('#trade-review-note').before(row); }
  const sol = value => `${formatTokenBaseAmount(value, 9)} SOL`;
  const network = fee == null ? null : BigInt(fee);
  if (network == null) { row.textContent = 'Network fee estimate unavailable. Account deposits may also apply; review total SOL changes in your wallet before signing.'; return; }
  const appFee = BigInt(trade.feeLamports || 0);
  if (trade.side === 'buy') {
    const maximum = trade.maximumInputAmount ? BigInt(trade.maximumInputAmount.toString())
      : BigInt(trade.quoteAmount.toString()) + BigInt(trade.quoteAmount.toString()) * BigInt(Math.floor(Number(trade.slippagePercent) * 10)) / 1000n;
    row.textContent = `Estimated network fee: ${sol(network)}. Maximum trade + app fee + estimated network fee: ${sol(maximum + appFee + network)}. Account deposits are additional and may be refundable. Your wallet shows the final SOL changes.`;
  } else row.textContent = `Estimated network fee: ${sol(network)}, paid separately from the trade. The minimum SOL above includes slippage and app fee; subtract the network fee for the estimated wallet change. Account deposits or refunds can also affect it.`;
}
