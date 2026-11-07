const LAMPORTS_PER_SOL = 1_000_000_000;

export function describeTradeQuote(trade, slippagePercent) {
  const outputDecimals = trade.side === 'buy' ? trade.tokenDecimals : 9;
  const expected = Number(trade.outputAmount.toString()) / (10 ** outputDecimals);
  const slippageBps = Math.round(Number(slippagePercent) * 100);
  const floorAmount = trade.minimumOutputAmount || ((BigInt(trade.outputAmount.toString()) * BigInt(10_000 - slippageBps)) / 10_000n);
  const minimum = Number(floorAmount.toString()) / (10 ** outputDecimals);
  const appFeeLamports = BigInt(trade.feeLamports || 0);
  const expectedNetSol = trade.side === 'sell' ? Number(BigInt(trade.outputAmount.toString()) - appFeeLamports) / LAMPORTS_PER_SOL : null;
  const minimumNetSol = trade.side === 'sell' ? Number(BigInt(floorAmount.toString()) - appFeeLamports) / LAMPORTS_PER_SOL : null;
  const maximumSpendSol = trade.side === 'buy' && trade.maximumInputAmount
    ? Number(trade.maximumInputAmount.toString()) / LAMPORTS_PER_SOL
    : null;
  return { expected, minimum, expectedNetSol, minimumNetSol, maximumSpendSol, outputSymbol: trade.side === 'buy' ? 'tokens' : 'SOL', appFeeSol: trade.feeLamports / LAMPORTS_PER_SOL, route: trade.route || 'curve' };
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

