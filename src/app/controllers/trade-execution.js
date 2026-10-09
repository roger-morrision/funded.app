// Dependencies and mutable application state are read live through appState.
export function createTradeExecutionController(appState) {
  // app-source: 565
  function queueTradeQuote(delay = 350){
    clearTimeout(appState.tradeQuoteTimer);
    if (!appState.tradeInputs().valid || !appState.wallet || !appState.canSignTransactions(appState.wallet) || document.visibilityState === 'hidden' || document.querySelector('#trade-panel')?.hidden) return;
    appState.tradeQuoteTimer = setTimeout(() => { void appState.prepareTradeQuote().catch(() => {}); }, delay);
  }
  // app-source-end

  // app-source: 566
  function refreshTradeQuoteWhenIdle(version){
    if (version !== appState.tradeQuoteVersion) return;
    if (document.querySelector('#trade-review-dialog')?.open || appState.tradeActionBusy) {
      appState.tradeQuoteTimer = setTimeout(() => appState.refreshTradeQuoteWhenIdle(version), 1000);
      return;
    }
    appState.invalidateTradePreview();
    appState.queueTradeQuote(0);
  }
  // app-source-end

  // app-source: 567
  async function prepareTradeQuote({ connectIfNeeded = false } = {}){
    const { mint, side, amount, slippagePercent, valid } = appState.tradeInputs();
    if (!valid) throw new Error('Enter a positive amount and slippage between 0.1% and 10%.');
    if (!appState.wallet && connectIfNeeded) await appState.connectWallet();
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) throw new Error('Connect a signing wallet to calculate the trade quote.');
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
    if (appState.tradePreview?.inputKey === inputKey && Date.now() - appState.tradePreview.preparedAt < 15_000) return appState.tradePreview;
    if (appState.tradeQuoteInFlight?.inputKey === inputKey && appState.tradeQuoteInFlight.version === appState.tradeQuoteVersion) return appState.tradeQuoteInFlight.promise;
    const version = appState.tradeQuoteVersion;
    const request = (async () => {
      appState.setTradeStatus('Calculating the current on-chain quote…');
      const previewConnection = await appState.getTradePreviewConnection();
      appState.assertWalletSessionCurrent(session);
      const trade = await appState.buildTradeTransaction({ connection: previewConnection, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: appState.TRADE_FEE_OWNER, feeBps: appState.TRADE_FEE_BPS });
      appState.assertWalletSessionCurrent(session);
      if (version !== appState.tradeQuoteVersion || !appState.tradeInputs().valid || `${appState.tradeInputs().mint}:${appState.tradeInputs().side}:${appState.tradeInputs().amount}:${appState.tradeInputs().slippagePercent}:${session.address}` !== inputKey) return null;
      const quote = appState.describeTradeQuote(trade, slippagePercent);
      if (side === 'sell' && quote.minimumNetSol <= 0) throw new Error('The app fee would exceed the minimum SOL output. Increase the sell amount.');
      appState.tradePreview = { trade, inputKey, preparedAt: Date.now() };
      document.querySelector('#trade-live-countdown').innerHTML = appState.quoteCountdownMarkup(appState.tradePreview.preparedAt + 15_000);
      appState.renderTradeBalances();
      const outputDigits = quote.outputSymbol === 'SOL' ? 9 : 6;
      const receiveText = `${quote.expected.toLocaleString('en-US', { maximumFractionDigits: outputDigits })} ${quote.outputSymbol}`;
      const estimateCard = document.querySelector('#trade-live-estimate');
      estimateCard.querySelector('span').textContent = side === 'sell' ? 'Estimated SOL to wallet' : 'Estimated tokens received';
      document.querySelector('#trade-live-amount').textContent = `≈ ${side === 'sell' ? `${quote.expectedNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL` : receiveText}`;
      document.querySelector('#trade-live-detail').textContent = side === 'sell'
        ? `After app fee · minimum after ${slippagePercent}% slippage: ${quote.minimumNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL · network fee additional.`
        : `Minimum after ${slippagePercent}% slippage: ${quote.minimum.toLocaleString('en-US', { maximumFractionDigits:outputDigits })} ${quote.outputSymbol}.`;
      estimateCard.classList.add('is-ready');
      const slippageText = quote.maximumSpendSol != null
        ? `Quoted receive: ${receiveText}. Maximum pool spend: ${quote.maximumSpendSol.toFixed(9)} SOL with ${slippagePercent}% slippage.`
        : side === 'sell'
          ? `Gross Pump output: ${receiveText}. Estimated to wallet after app fee: ${quote.expectedNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL. Minimum after slippage and app fee: ${quote.minimumNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL.`
          : `Estimated receive: ${receiveText}. Slippage floor: ${quote.minimum.toLocaleString('en-US', { maximumFractionDigits: outputDigits })} ${quote.outputSymbol}.`;
      const feeText = quote.maximumSpendSol != null
        ? `Maximum pool spend includes Pump pool fees. App fee: ${quote.appFeeSol.toFixed(9)} SOL, plus network/account costs.`
        : `App fee: ${quote.appFeeSol.toFixed(9)} SOL, plus network and Pump fees.`;
      document.querySelector('#trade-quote').textContent = `${quote.route === 'graduated-pool' ? 'Graduated pool' : 'Pump curve'} · ${slippageText} ${feeText}`;
      appState.setTradeStatus('Review this quote and the transaction in your wallet before signing.');
      appState.tradeQuoteTimer = setTimeout(() => appState.refreshTradeQuoteWhenIdle(version), 12_000);
      return appState.tradePreview;
    })();
    appState.tradeQuoteInFlight = { inputKey, version, promise:request };
    try { return await request; }
    catch (error) {
      if (version === appState.tradeQuoteVersion && appState.isWalletSessionCurrent(session)) {
        appState.tradePreview = null;
        appState.renderTradeBalances();
        const card = document.querySelector('#trade-live-estimate');
        card?.classList.add('is-unavailable');
        document.querySelector('#trade-live-amount').textContent = 'Quote unavailable';
        document.querySelector('#trade-live-detail').textContent = error.message;
        document.querySelector('#trade-quote').textContent = appState.tradePreviewFailureMessage(error, side);
        appState.setTradeStatus(appState.tradePreviewFailureMessage(error, side), true);
      }
      throw error;
    } finally { if (appState.tradeQuoteInFlight?.promise === request) appState.tradeQuoteInFlight = null; }
  }
  // app-source-end

  // app-source: 568
  async function openTradeReview(){
    if (appState.tradeActionBusy) return;
    const { mint, side, amount, slippagePercent, valid } = appState.tradeInputs();
    if (!valid) return appState.setTradeStatus('Enter a positive amount and slippage between 0.1% and 10%.', true);
    appState.tradeActionBusy = true;
    appState.updateTradeActionState();
    const version = appState.tradeQuoteVersion;
    try {
      const prepared = await appState.prepareTradeQuote({ connectIfNeeded:true });
      if (!prepared) return;
      const session = appState.captureWalletSession();
      const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session?.address || ''}`;
      if (!session || prepared.inputKey !== inputKey || Date.now() - prepared.preparedAt > 15_000) return;
      const shownCoin = appState.getCoinMintAddress() === mint;
      const review = appState.buildTradeReview({ trade:prepared.trade, side, amount, slippagePercent, mint, wallet:session.address,
        tokenName:shownCoin ? document.querySelector('#coin-page-title')?.textContent?.trim() : '',
        tokenSymbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent?.trim() : '' });
      const fields = {
        '#trade-review-title':review.title, '#trade-review-token-name':review.tokenName,
        '#trade-review-pay-label':review.payLabel, '#trade-review-pay':review.payAmount,
        '#trade-review-receive-label':review.receiveLabel, '#trade-review-receive':review.receiveAmount,
        '#trade-review-limit-label':review.limitLabel, '#trade-review-limit':review.limitAmount,
        '#trade-review-minimum-label':review.minimumLabel, '#trade-review-minimum':review.minimumAmount,
        '#trade-review-slippage':review.slippage, '#trade-review-fee':review.fee,
        '#trade-review-route':review.route, '#trade-review-mint':review.mint, '#trade-review-wallet':review.wallet,
        '#trade-review-note':review.note, '#trade-review-confirm':review.confirmLabel,
      };
      for (const [selector, value] of Object.entries(fields)) document.querySelector(selector).textContent = value;
      document.querySelector('#trade-review-minimum-row').hidden = !review.minimumLabel;
      document.querySelector('#trade-review-dialog').dataset.side = side;
      document.querySelector('#trade-review-countdown').innerHTML = appState.quoteCountdownMarkup(prepared.preparedAt + 15_000);
      document.querySelector('#trade-review-dialog').showModal();
    } catch (error) { if (version === appState.tradeQuoteVersion) appState.setTradeStatus(appState.tradePreviewFailureMessage(error, side), true); }
    finally { appState.tradeActionBusy = false; appState.updateTradeActionState(); }
  }
  // app-source-end

  // app-source: 569
  async function executeTrade(){
    if (!appState.wallet) return appState.setTradeStatus('Connect a signing wallet to trade.', true);
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) return appState.setTradeStatus('Open this app in a signing wallet to trade.', true);
    const mint = document.querySelector('#trade-mint').value.trim(); const side = document.querySelector('#trade-side').value;
    const amount = appState.parseTradeAmountInput(document.querySelector('#trade-amount').value); const slippagePercent = Number(document.querySelector('#trade-slippage').value);
    if (!mint || !Number.isFinite(amount) || amount <= 0) { appState.setTradeStatus('Enter a valid mint and positive trade amount.', true); return; }
    if (!appState.TRADE_FEE_OWNER) { appState.setTradeStatus('Trading is disabled: configure VITE_FUNDED_TRADE_FEE_OWNER for the app owner.', true); return; }
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
    if (!appState.tradePreview || appState.tradePreview.inputKey !== inputKey || Date.now() - appState.tradePreview.preparedAt > 15_000) {
      appState.invalidateTradePreview();
      appState.setTradeStatus('The quote changed or expired. Calculating a new quote for review.');
      await appState.openTradeReview();
      return;
    }
    clearTimeout(appState.tradeQuoteTimer);
    const tradeShare = document.querySelector('#trade-share');
    if (tradeShare) tradeShare.hidden = true;
    appState.tradeActionBusy = true;
    appState.updateTradeActionState();
    let submittedSignature = null;
    try {
      const activeConnection = appState.connection || (await appState.getSolana(), appState.connection);
      appState.assertWalletSessionCurrent(session);
      if (side === 'buy') {
        const latestBalance = await activeConnection.getBalance(session.provider.publicKey, 'confirmed');
        if (!appState.hasBuyBalance(latestBalance, { amountSol:amount, slippagePercent, feeBps:appState.TRADE_FEE_BPS, trade:appState.tradePreview.trade })) throw new Error('Insufficient SOL for maximum spend, app fee, and network/account allowance.');
      }
      appState.assertWalletSessionCurrent(session);
      if (!appState.currentTradePreview()) throw new Error('The trade quote expired during balance verification. Review a fresh quote.');
      const shownCoin = appState.getCoinMintAddress() === mint;
      const result = await appState.submitTrade({ connection: activeConnection, provider: session.provider, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: appState.TRADE_FEE_OWNER, feeBps: appState.TRADE_FEE_BPS, preparedTrade: appState.tradePreview.trade, tokenName:shownCoin ? document.querySelector('#coin-page-title')?.textContent?.trim() : '', tokenSymbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent?.trim() : '', assertWalletCurrent: () => appState.assertWalletSessionCurrent(session), onStatus: message => { if (appState.isWalletSessionCurrent(session)) appState.setTradeStatus(message); } });
      submittedSignature = result.signature;
      appState.setTradeReceiptStatus('Trade submitted and confirmed. Waiting for finalization before showing it as complete.', submittedSignature);
      const finalization = await appState.waitForSignatureConfirmation(activeConnection, { signature:submittedSignature, commitment:'finalized' });
      if (finalization.value?.err) { const failure = new Error('The submitted transaction failed on-chain.'); failure.finalizedFailure = true; throw failure; }
      if (!appState.isWalletSessionCurrent(session)) return;
      appState.pendingTradeVerifications.set(submittedSignature, { signature:submittedSignature, mint, side, walletAddress:session.address,
        symbol:shownCoin ? (document.querySelector('#coin-symbol')?.textContent?.trim() || 'token') : 'token', feeLamports:result.feeLamports });
      appState.setTradeReceiptStatus(`${side === 'buy' ? 'Buy' : 'Sell'} finalized. Checking token balance change and indexed trade row.`, submittedSignature);
      await appState.verifyPendingTrade(activeConnection, submittedSignature);
      void appState.refreshTradeBalances();
    } catch (error) {
      const signature = submittedSignature || error.signature;
      if (appState.isWalletSessionCurrent(session)) {
        const message = error.finalizedFailure
        ? 'Trade failed on-chain. Review the receipt before making another trade.'
        : signature ? `Trade outcome is uncertain until the signature is checked. ${error.message} Do not retry before reviewing it.`
          : `Trade was not submitted or could not be prepared. ${error.message}`;
        if (signature) appState.setTradeReceiptStatus(message, signature, error.finalizedFailure);
        else appState.setTradeStatus(message, true);
      }
    } finally {
      appState.tradeActionBusy = false;
      appState.renderRoundTripAction();
      if (appState.isWalletSessionCurrent(session)) { appState.invalidateTradePreview(); appState.queueTradeQuote(); }
    }
  }
  // app-source-end

  // app-source: 570
  async function verifyPendingTrade(activeConnection = null, targetSignature = null){
    const pending = targetSignature ? appState.pendingTradeVerifications.get(targetSignature) : appState.pendingTradeVerifications.values().next().value;
    if (!pending) return;
    const session = appState.captureWalletSession();
    if (!session || session.address !== pending.walletAddress) return;
    const button = document.querySelector('#trade-verify');
    if (button) { button.hidden = false; button.disabled = true; }
    try {
      const rpc = activeConnection || appState.connection || (await appState.getSolana(), appState.connection);
      const [receipt, market] = await Promise.allSettled([
        rpc.getParsedTransaction(pending.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
        appState.apiRequest(`/api/tokens/${encodeURIComponent(pending.mint)}/market-activity`, { signal:AbortSignal.timeout(12000) }),
      ]);
      if (!appState.isWalletSessionCurrent(session) || appState.pendingTradeVerifications.get(pending.signature) !== pending) return;
      const evidence = appState.assessTradeCompletion({ transaction:receipt.status === 'fulfilled' ? receipt.value : null,
        marketActivity:market.status === 'fulfilled' && market.value.available ? market.value.data : null,
        wallet:pending.walletAddress, mint:pending.mint, side:pending.side, signature:pending.signature });
      if (!evidence.complete) {
        const reason = !evidence.receiptVerified ? 'Finalized token balance change is not verified yet.' : 'Matching trade row is not indexed yet.';
        appState.pendingTradeVerifications.delete(pending.signature);
        appState.pendingTradeVerifications.set(pending.signature, pending);
        appState.setTradeReceiptStatus(`${pending.side === 'buy' ? 'Buy' : 'Sell'} finalized; ${reason} ${appState.pendingTradeVerifications.size} receipt${appState.pendingTradeVerifications.size === 1 ? '' : 's'} pending. Check status again before treating it as complete.`, pending.signature);
        return;
      }
      appState.pendingTradeVerifications.delete(pending.signature);
      if (button) button.hidden = appState.pendingTradeVerifications.size === 0;
      appState.setTradeReceiptStatus(`${pending.side === 'buy' ? 'Buy' : 'Sell'} finalized with verified balance change and indexed trade. App fee: ${(pending.feeLamports / 1_000_000_000).toFixed(6)} SOL.`, pending.signature);
      appState.rememberRoundTripReceipt({ walletAddress:pending.walletAddress, mint:pending.mint, side:pending.side, signature:pending.signature, symbol:pending.symbol });
        appState.productEvent('trade_confirmed');
      appState.renderRoundTripAction();
      const share = document.querySelector('#trade-share');
      if (share) {
        Object.assign(share.dataset, { signature:pending.signature, mint:pending.mint, wallet:pending.walletAddress, side:pending.side, symbol:pending.symbol });
        share.hidden = false;
      }
      if (appState.getCoinMintAddress() === pending.mint) void appState.loadCoinOnChain(pending.mint);
      appState.showToast(`${pending.side === 'buy' ? 'Buy' : 'Sell'} verified on Solana`);
      appState.refreshWalletInfo();
      void appState.refreshPortfolioHoldings();
    } finally { if (button) button.disabled = false; }
  }
  // app-source-end

  return { queueTradeQuote, refreshTradeQuoteWhenIdle, prepareTradeQuote, openTradeReview, executeTrade, verifyPendingTrade };
}
