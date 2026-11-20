const LAMPORTS_PER_SOL = 1_000_000_000;

export function tradeTokenSymbol(mint, records = []) {
  if (!mint) return 'tokens';
  for (const record of records) {
    if ((record?.mint || record?.address) !== mint) continue;
    const symbol = String(record.symbol || '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
    if (symbol && symbol !== mint && !symbol.includes('…') && !symbol.includes('...')) return symbol;
  }
  return 'tokens';
}

export function describeTradeQuote(trade, slippagePercent, tokenSymbol = trade.tokenSymbol) {
  const quoteDecimals = Number.isInteger(trade.quoteDecimals) ? trade.quoteDecimals : 9;
  const quoteSymbol = trade.quoteSymbol || 'SOL';
  const outputDecimals = trade.side === 'buy' ? trade.tokenDecimals : quoteDecimals;
  const expected = Number(trade.outputAmount.toString()) / (10 ** outputDecimals);
  const slippageBps = Math.round(Number(slippagePercent) * 100);
  const floorAmount = trade.minimumOutputAmount || ((BigInt(trade.outputAmount.toString()) * BigInt(10_000 - slippageBps)) / 10_000n);
  const minimum = Number(floorAmount.toString()) / (10 ** outputDecimals);
  const appFeeUnits = BigInt(trade.feeLamports || 0);
  const scale = 10 ** quoteDecimals;
  const expectedNet = trade.side === 'sell' ? Number(BigInt(trade.outputAmount.toString()) - appFeeUnits) / scale : null;
  const minimumNet = trade.side === 'sell' ? Number(BigInt(floorAmount.toString()) - appFeeUnits) / scale : null;
  const maximumSpend = trade.side === 'buy' && trade.maximumInputAmount
    ? Number(trade.maximumInputAmount.toString()) / scale : null;
  return { expected, minimum, expectedNet, minimumNet, maximumSpend, quoteSymbol, quoteDecimals,
    expectedNetSol:quoteSymbol === 'SOL' ? expectedNet : null,
    minimumNetSol:quoteSymbol === 'SOL' ? minimumNet : null,
    maximumSpendSol:quoteSymbol === 'SOL' ? maximumSpend : null,
    outputSymbol: trade.side === 'buy' ? String(tokenSymbol||'tokens').trim() : quoteSymbol,
    appFee:Number(appFeeUnits) / scale, appFeeSol:quoteSymbol === 'SOL' ? Number(appFeeUnits) / LAMPORTS_PER_SOL : null,
    route: trade.route || 'curve' };
}

export function estimateBuyTokenAmountFromSnapshot({ amountSol, curveSnapshot = null, graduatedPoolSnapshot = null } = {}) {
  const inputSol = Number(amountSol);
  if (!Number.isFinite(inputSol) || inputSol <= 0) throw new Error('Enter a positive SOL amount.');
  const graduated = graduatedPoolSnapshot && Number(graduatedPoolSnapshot.baseTokenReserves) > 0;
  const tokenReserves = Number(graduated ? graduatedPoolSnapshot.baseTokenReserves : curveSnapshot?.virtualTokenReserves);
  const quoteReservesSol = Number(graduated ? graduatedPoolSnapshot.effectiveQuoteReservesSol : curveSnapshot?.virtualQuoteReservesSol);
  if (!Number.isFinite(tokenReserves) || tokenReserves <= 0 || !Number.isFinite(quoteReservesSol) || quoteReservesSol <= 0) {
    throw new Error('Verified market reserves are unavailable.');
  }
  const expectedTokens = tokenReserves * inputSol / (quoteReservesSol + inputSol);
  if (!Number.isFinite(expectedTokens) || expectedTokens <= 0 || expectedTokens >= tokenReserves) throw new Error('This amount cannot be estimated from the current reserves.');
  return {
    inputSol,
    expectedTokens,
    route: graduated ? 'graduated-pool' : 'curve',
    observedAt: graduated ? graduatedPoolSnapshot.observedAt : curveSnapshot?.observedAt,
  };
}

