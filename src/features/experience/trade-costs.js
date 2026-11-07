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
