// Dependencies and mutable application state are read live through appState.
export function createTradeStateController(appState) {
  // app-source: 545
  function showToast(message){
    appState.toast.textContent = message;
    appState.toast.classList.add('show');
    clearTimeout(appState.toastTimer);
    appState.toastTimer = setTimeout(() => {
      appState.toast.classList.remove('show');
      setTimeout(() => {
        if (!appState.toast.classList.contains('show') && appState.toast.textContent === message) appState.toast.textContent = '';
      }, 300);
    }, 2600);
  }
  // app-source-end

  // app-source: 547
  function setTradeStatus(message, error = false){ const node = document.querySelector('#trade-status'); if (node) { node.textContent = message; node.className = `field-help ${error ? 'funded-mint-invalid' : ''}`; } }
  // app-source-end

  // app-source: 548
  function setTradeReceiptStatus(message, signature, error = false) {
    const node = document.querySelector('#trade-receipt-status');
    if (!node) return;
    node.hidden = false;
    node.textContent = message;
    node.className = `field-help ${error ? 'funded-mint-invalid' : ''}`;
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(signature || ''))) return;
    const receipt = document.createElement('a');
    receipt.href = appState.exploreExplorer(`tx/${encodeURIComponent(signature)}`);
    receipt.textContent = ' Check transaction ↗';
    receipt.target = '_blank';
    receipt.rel = 'noopener noreferrer';
    node.append(receipt);
  }
  // app-source-end

  // app-source: 549
  function tradeBalanceKey(){
    const session = appState.captureWalletSession();
    const mint = document.querySelector('#trade-mint')?.value.trim();
    return session && mint ? `${session.address}:${mint}` : '';
  }
  // app-source-end

  // app-source: 550
  function roundTripStorageKey(walletAddress, mint){ return `${appState.TRADE_ROUNDTRIP_KEY}:${walletAddress}:${mint}`; }
  // app-source-end

  // app-source: 551
  function savedRoundTrip(walletAddress, mint){
    try { return JSON.parse(localStorage.getItem(appState.roundTripStorageKey(walletAddress, mint)) || 'null'); } catch { return null; }
  }
  // app-source-end

  // app-source: 552
  function rememberRoundTripReceipt({ walletAddress, mint, side, signature, symbol }){
    const prior = appState.savedRoundTrip(walletAddress, mint);
    const next = side === 'buy' ? { buySignature:signature, symbol } : prior?.buySignature
      ? { ...prior, sellSignature:signature, symbol:symbol || prior.symbol } : null;
    if (next) try { localStorage.setItem(appState.roundTripStorageKey(walletAddress, mint), JSON.stringify(next)); } catch { /* Sharing history is optional. */ }
    return next;
  }
  // app-source-end

  // app-source: 553
  function renderRoundTripAction(){
    return appState.renderRoundTripActionView({ tradeActionBusy: appState.tradeActionBusy }, { captureWalletSession: appState.captureWalletSession, savedRoundTrip: appState.savedRoundTrip });
  }
  // app-source-end

  // app-source: 554
  function resetTradeBalances(){
    appState.tradeBalanceRequest++;
    appState.tradeBalanceState = { key:'', solLamports:null, tokenRaw:null, tokenDecimals:0 };
    appState.renderTradeBalances();
  }
  // app-source-end

  // app-source: 555
  function renderTradeBalances(){
    return appState.renderTradeBalancesView({ tradeBalanceState: appState.tradeBalanceState, coinTradeEstimate: appState.coinTradeEstimate, wallet: appState.wallet, TRADE_FEE_BPS: appState.TRADE_FEE_BPS }, { renderRoundTripAction: appState.renderRoundTripAction, tradeBalanceKey: appState.tradeBalanceKey, tradeInputs: appState.tradeInputs, currentTradePreview: appState.currentTradePreview, updateTradeActionState: appState.updateTradeActionState });
  }
  // app-source-end

  // app-source: 556
  async function refreshTradeBalances(){
    const key = appState.tradeBalanceKey();
    const session = appState.captureWalletSession();
    const mint = document.querySelector('#trade-mint')?.value.trim();
    if (!key || !session || !mint) { appState.resetTradeBalances(); return; }
    const request = ++appState.tradeBalanceRequest;
    appState.tradeBalanceState = { key, solLamports:null, tokenRaw:null, tokenDecimals:appState.coinTradeEstimate?.mint === mint ? appState.coinTradeEstimate.decimals : 0 };
    appState.renderTradeBalances();
    try {
      const { PublicKey } = await appState.getSolana();
      const rpc = await appState.getExploreConnection();
      const [sol, tokens] = await Promise.allSettled([
        rpc.getBalance(session.provider.publicKey, 'confirmed'),
        rpc.getParsedTokenAccountsByOwner(session.provider.publicKey, { mint:new PublicKey(mint) }, 'confirmed'),
      ]);
      if (request !== appState.tradeBalanceRequest || !appState.isWalletSessionCurrent(session) || key !== appState.tradeBalanceKey()) return;
      const accounts = tokens.status === 'fulfilled' ? tokens.value.value : [];
      const parsed = accounts.map(account => account.account.data.parsed?.info?.tokenAmount).filter(Boolean);
      appState.tradeBalanceState = {
        key,
        solLamports:sol.status === 'fulfilled' ? BigInt(sol.value) : null,
        tokenRaw:tokens.status === 'fulfilled' ? parsed.reduce((total, token) => total + BigInt(token.amount), 0n) : null,
        tokenDecimals:parsed.length ? Number(parsed[0].decimals) : appState.coinTradeEstimate?.mint === mint ? appState.coinTradeEstimate.decimals : 0,
      };
    } catch {
      if (request !== appState.tradeBalanceRequest || key !== appState.tradeBalanceKey()) return;
      appState.tradeBalanceState = { key, solLamports:null, tokenRaw:null, tokenDecimals:0 };
    }
    appState.renderTradeBalances();
  }
  // app-source-end

  // app-source: 557
  function formatTradeEstimateAmount(value){
    if (!Number.isFinite(value)) return '—';
    const digits = value < 0.01 ? 9 : value < 1 ? 6 : 4;
    return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  }
  // app-source-end

  // app-source: 558
  function renderTradeAmountEstimate(){
    return appState.renderTradeAmountEstimateView({ tradePreview: appState.tradePreview, wallet: appState.wallet, coinTradeEstimate: appState.coinTradeEstimate }, { tradeInputs: appState.tradeInputs, captureWalletSession: appState.captureWalletSession, formatTradeEstimateAmount: appState.formatTradeEstimateAmount });
  }
  // app-source-end

  // app-source: 559
  function updateTradeAmountLabel(){
    return appState.updateTradeAmountLabelView({ coinTradeEstimate: appState.coinTradeEstimate }, { renderTradeBalances: appState.renderTradeBalances, renderTradeAmountEstimate: appState.renderTradeAmountEstimate });
  }
  // app-source-end

  // app-source: 560
  function tradeInputs(){
    const mint = document.querySelector('#trade-mint')?.value.trim() || '';
    const side = document.querySelector('#trade-side')?.value;
    const amount = appState.parseTradeAmountInput(document.querySelector('#trade-amount')?.value);
    const slippagePercent = Number(document.querySelector('#trade-slippage')?.value);
    return { mint, side, amount, slippagePercent, valid: Boolean(mint && ['buy', 'sell'].includes(side) && Number.isFinite(amount) && amount > 0 && Number.isFinite(slippagePercent) && slippagePercent >= 0.1 && slippagePercent <= 10) };
  }
  // app-source-end

  // app-source: 561
  function currentTradePreview(inputs = appState.tradeInputs()){
    const session = appState.captureWalletSession();
    const key = `${inputs.mint}:${inputs.side}:${inputs.amount}:${inputs.slippagePercent}:${session?.address || ''}`;
    return appState.tradePreview?.inputKey === key && Date.now() - appState.tradePreview.preparedAt < 15_000 ? appState.tradePreview : null;
  }
  // app-source-end

  // app-source: 562
  function updateTradeActionState(){
    const submit = document.querySelector('#trade-submit');
    const inputs = appState.tradeInputs();
    const { side, amount, valid } = inputs;
    const current = Boolean(appState.tradeBalanceState.key && appState.tradeBalanceState.key === appState.tradeBalanceKey());
    const preview = appState.currentTradePreview(inputs);
    const sufficient = current && valid && (side === 'buy'
      ? appState.hasBuyBalance(appState.tradeBalanceState.solLamports, { amountSol:amount, slippagePercent:inputs.slippagePercent, feeBps:appState.TRADE_FEE_BPS, trade:preview?.trade })
      : appState.tradeBalanceState.tokenRaw != null && amount <= Number(appState.tradeBalanceState.tokenRaw) / (10 ** appState.tradeBalanceState.tokenDecimals));
    if (submit) submit.disabled = appState.tradeActionBusy || !appState.wallet || !appState.canSignTransactions(appState.wallet) || !valid || !preview || !sufficient;
  }
  // app-source-end

  // app-source: 563
  function invalidateTradePreview(){
    appState.tradeQuoteVersion++;
    clearTimeout(appState.tradeQuoteTimer);
    appState.tradeQuoteTimer = null;
    appState.tradePreview = null;
    document.querySelector('#trade-live-countdown')?.replaceChildren();
    const reviewDialog = document.querySelector('#trade-review-dialog');
    if (reviewDialog?.open) reviewDialog.close();
    const quote = document.querySelector('#trade-quote');
    if (quote) quote.textContent = !appState.tradeInputs().valid ? 'Enter a positive amount to calculate the quote.' : !appState.wallet ? 'Connect a signing wallet to calculate an exact trade quote.' : 'Calculating the current route, amount, slippage, and fees.';
    appState.updateTradeActionState();
    appState.renderTradeAmountEstimate();
  }
  // app-source-end

  // app-source: 564
  function tradePreviewFailureMessage(error, side){
    const message = String(error?.message || error || 'Unknown error');
    if (side === 'sell' && /Associated token account not found for mint:/i.test(message)) {
      return 'Sell unavailable: this wallet has no token account for this mint. Connect a wallet that holds the token. No trade was submitted.';
    }
    return `Quote unavailable: ${message}`;
  }
  // app-source-end

  return { showToast, setTradeStatus, setTradeReceiptStatus, tradeBalanceKey, roundTripStorageKey, savedRoundTrip, rememberRoundTripReceipt, renderRoundTripAction, resetTradeBalances, renderTradeBalances, refreshTradeBalances, formatTradeEstimateAmount, renderTradeAmountEstimate, updateTradeAmountLabel, tradeInputs, currentTradePreview, updateTradeActionState, invalidateTradePreview, tradePreviewFailureMessage };
}
