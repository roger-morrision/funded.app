// Dependencies and mutable application state are read live through appState.
export function createBuybackPreviewController(appState) {
  // app-source: 356
  function recordBuybackPreviewClaim(){
    const fees = Number(document.querySelector('#buyback-example-fees').value);
    if (!Number.isFinite(fees) || fees <= 0) { appState.renderBuybackDashboard('Enter a gross creator-fee amount above zero.'); return; }
    const state = appState.getBuybackPreviewState();
    const signature = `preview-claim-${Date.now()}-${state.accruals.length + 1}`;
    state.accruals.push(appState.buildBuybackAccrual({ claimSignature: signature, grossCreatorFees: fees, asset: 'SOL' }));
    appState.saveBuybackPreviewState(state);
    appState.renderBuybackDashboard(`${appState.formatBuybackAmount(fees)} SOL claim recorded. Exactly ${appState.formatBuybackAmount(fees * 0.01)} SOL was reserved for buyback.`);
    appState.showToast('Example fee claim allocated to the buyback vault');
  }
  // app-source-end

  // app-source: 357
  function runBuybackPreview(){
    const state = appState.getBuybackPreviewState();
    const summary = appState.summarizeBuybackLedger(state.accruals, state.receipts);
    const pending = summary.pendingByAsset.SOL || 0;
    const executedIds = new Set(state.receipts.flatMap(receipt => receipt.accrualIds || []));
    const pendingAccruals = state.accruals.filter(accrual => !executedIds.has(accrual.id));
    const lastReference = state.receipts.at(-1)?.executedAt || pendingAccruals[0]?.claimedAt || null;
    const decision = appState.evaluateBuybackBatch({ pendingAmount: pending, asset: 'SOL', lastExecutionAt: lastReference, quote: { routeVerified: true, ageSeconds: 2, slippageBps: 50, priceImpactBps: 40, poolLiquidityAmount: Math.max(1000, pending * 400) } });
    if (!decision.executable) { appState.renderBuybackDashboard(decision.reason === 'accumulating' ? 'The batch is still below 0.25 SOL and the six-hour maximum wait has not elapsed.' : `Execution blocked by safeguard: ${decision.reason}.`); return; }
    const tokensBought = Number((decision.executionAmount * 250).toFixed(6));
    const supplyBefore = 1_000_000_000 - summary.burnedTokens;
    const stamp = Date.now();
    state.receipts.push(appState.buildBuybackReceipt({ accrualIds: pendingAccruals.map(accrual => accrual.id), asset: 'SOL', inputAmount: decision.executionAmount, tokensBought, buySignature: `preview-buy-${stamp}`, burnSignature: `preview-burn-${stamp}`, supplyBefore, supplyAfter: supplyBefore - tokensBought, mode: 'local-preview' }));
    appState.saveBuybackPreviewState(state);
    appState.renderBuybackDashboard(`Protected preview bought and burned ${appState.formatBuybackAmount(tokensBought, 2)} $FUNDED. No transaction was submitted.`);
    appState.showToast('Buyback preview completed');
  }
  // app-source-end

  return { recordBuybackPreviewClaim, runBuybackPreview };
}
