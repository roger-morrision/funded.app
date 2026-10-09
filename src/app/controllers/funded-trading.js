// Dependencies and mutable application state are read live through appState.
export function createFundedTradingController(appState) {
  // app-source: 351
  function renderFundedBuyControl(message = null){
    const input = document.querySelector('#funded-buy-amount');
    const button = document.querySelector('#funded-buy-submit');
    const badge = document.querySelector('#funded-buy-route-state');
    const status = document.querySelector('#funded-buy-status');
    if (!input || !button || !badge || !status) return;
    const ready = appState.fundedBuyRoute.status === 'ready';
    const amount = Number(input.value);
    input.disabled = !ready || appState.fundedBuyBusy;
    button.disabled = !ready || appState.fundedBuyBusy || !Number.isFinite(amount) || amount <= 0;
    button.textContent = appState.fundedBuyBusy ? 'Waiting for Solana…' : appState.fundedBuyPreview ? 'Confirm buy' : appState.wallet ? 'Preview buy' : 'Connect wallet to preview';
    badge.textContent = ready ? 'Solana pool live' : appState.fundedBuyRoute.status === 'checking' ? 'Checking' : 'Unavailable';
    badge.classList.toggle('unavailable', !ready);
    const clock = document.querySelector('#funded-buy-countdown');
    if (clock) clock.innerHTML = appState.fundedBuyPreview && !appState.fundedBuyBusy ? appState.quoteCountdownMarkup(appState.fundedBuyPreview.preparedAt + 15_000) : '';
    if (message != null) status.textContent = message;
    else if (!ready) status.textContent = appState.fundedBuyRoute.reason;
  }
  // app-source-end

  // app-source: 352
  async function refreshFundedBuyRoute(signal){
    try {
      if (appState.APP_CLUSTER !== 'devnet' || appState.APP_MAINNET_READ_ONLY || !appState.PROTOCOL_FUNDED_MINT || !appState.PROTOCOL_FUNDED_SWAP_POOL) throw new Error('A Solana $FUNDED mint and pool are required.');
      const snapshot = await appState.withRpcRetry(async attempt => {
        if (attempt > 0) appState.tradePreviewConnection = null;
        const rpc = await appState.getTradePreviewConnection();
        return appState.fetchVerifiedPoolSnapshot({ connection:rpc, mint:appState.PROTOCOL_FUNDED_MINT, poolAddress:appState.PROTOCOL_FUNDED_SWAP_POOL });
      });
      signal?.throwIfAborted();
      if (appState.fundedBuyBusy) return;
      appState.fundedBuyPreview = null;
      appState.fundedBuyRoute = { status:'ready', snapshot, reason:null };
      appState.renderFundedBuyControl(`Verified Solana pool ${snapshot.pool.slice(0, 6)}…${snapshot.pool.slice(-4)} · ${snapshot.quoteReservesSol.toFixed(3)} SOL liquidity.`);
      appState.renderFundedTokenLanding();
    } catch (error) {
      signal?.throwIfAborted();
      if (appState.fundedBuyBusy) return;
      appState.fundedBuyPreview = null;
      const detail = String(error?.message || error);
      const reason = /(?:\b429\b|rate limit|too many requests)/i.test(detail)
        ? 'Buy preview is temporarily unavailable because Solana RPC is rate limited. Try again shortly.'
        : /(?:failed to fetch|networkerror|econnrefused|timed out)/i.test(detail)
          ? 'Buy preview is unavailable while the Solana RPC connection recovers.'
          : `Buy preview is unavailable: ${detail.slice(0, 220)}`;
      appState.fundedBuyRoute = { status:'unavailable', snapshot:null, reason };
      appState.renderFundedBuyControl();
      appState.renderFundedTokenLanding();
    }
  }
  // app-source-end

  // app-source: 353
  async function handleFundedBuy(){
    if (appState.fundedBuyBusy || appState.fundedBuyRoute.status !== 'ready') return;
    const amount = Number(document.querySelector('#funded-buy-amount')?.value);
    if (!Number.isFinite(amount) || amount <= 0) return appState.renderFundedBuyControl('Enter a positive SOL amount to preview.');
    const maxAmount = Math.min(0.01, appState.fundedBuyRoute.snapshot.quoteReservesSol * 0.03);
    if (amount > maxAmount) return appState.renderFundedBuyControl(`This test pool limits each buy to ${maxAmount.toFixed(6)} SOL (3% of verified reserves).`);
    if (!appState.wallet) { await appState.connectWallet(); if (!appState.wallet) return; }
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) return appState.renderFundedBuyControl('Open the app in a wallet that can sign Solana transactions.');
    const samePreview = appState.fundedBuyPreview && appState.fundedBuyPreview.amount === amount && appState.fundedBuyPreview.wallet === session.address;
    if (appState.fundedBuyPreview && (!samePreview || Date.now() - appState.fundedBuyPreview.preparedAt > 15_000)) {
      appState.fundedBuyPreview = null;
      return appState.renderFundedBuyControl('The quote changed or expired. Preview again before signing.');
    }
    appState.fundedBuyBusy = true;
    appState.renderFundedBuyControl();
    let submittedSignature = null;
    try {
      const rpc = await appState.getTradePreviewConnection();
      appState.assertWalletSessionCurrent(session);
      if (!appState.fundedBuyPreview) {
        const trade = await appState.buildVerifiedPoolTradeTransaction({ connection:rpc, side:'buy', mint:appState.PROTOCOL_FUNDED_MINT, poolAddress:appState.PROTOCOL_FUNDED_SWAP_POOL, user:session.provider.publicKey, amount, slippagePercent:1, feeOwner:appState.TRADE_FEE_OWNER, feeBps:appState.TRADE_FEE_BPS });
        appState.assertWalletSessionCurrent(session);
        const quote = appState.describeTradeQuote(trade, 1);
        appState.fundedBuyPreview = { trade, amount, wallet:session.address, preparedAt:Date.now() };
        appState.renderFundedBuyControl(`Estimated ${quote.expected.toLocaleString(undefined, { maximumFractionDigits:6 })} $FUNDED. Maximum pool spend ${quote.maximumSpendSol.toFixed(6)} SOL; app fee ${quote.appFeeSol.toFixed(6)} SOL, plus network costs.`);
        return;
      }
      const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await appState.getSolana();
      const mint = new PublicKey(appState.PROTOCOL_FUNDED_MINT);
      const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
      if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The $FUNDED mint is not a verified SPL mint.');
      const tokenAccount = getAssociatedTokenAddressSync(mint, session.provider.publicKey, false, mintInfo.owner);
      const beforeAccount = await rpc.getAccountInfo(tokenAccount, 'finalized');
      const before = beforeAccount ? BigInt((await rpc.getTokenAccountBalance(tokenAccount, 'finalized')).value.amount) : 0n;
      const preparedTrade = appState.fundedBuyPreview.trade;
      appState.fundedBuyPreview = null;
      const result = await appState.submitTrade({ connection:rpc, provider:session.provider, side:'buy', mint, user:session.provider.publicKey, amount, slippagePercent:1, feeOwner:appState.TRADE_FEE_OWNER, feeBps:appState.TRADE_FEE_BPS, preparedTrade, tokenName:'Funded', tokenSymbol:'FUNDED', assertWalletCurrent:()=>appState.assertWalletSessionCurrent(session), onStatus:appState.renderFundedBuyControl });
      submittedSignature = result.signature;
      await appState.waitForSignatureConfirmation(rpc, { signature:result.signature, commitment:'finalized' });
      appState.assertWalletSessionCurrent(session);
      const after = BigInt((await rpc.getTokenAccountBalance(tokenAccount, 'finalized')).value.amount);
      const minimum = BigInt((result.minimumOutputAmount || result.outputAmount).toString());
      if (after - before < minimum) throw new Error(`Transaction ${result.signature} finalized, but the expected $FUNDED balance increase was not observed.`);
      document.querySelector('#funded-buy-amount').value = '';
      appState.renderFundedBuyControl(`Buy finalized: ${result.signature}. Received ${Number(after - before) / 10 ** result.tokenDecimals} $FUNDED.`);
      appState.showToast('Verified $FUNDED buy finalized on Solana');
      void appState.loadFundedBurnState({ force:true });
    } catch (error) {
      appState.fundedBuyPreview = null;
      appState.renderFundedBuyControl(error.signature || submittedSignature
        ? `Confirmation is uncertain for ${error.signature || submittedSignature}. Check that signature on Solana before trying again.`
        : `Buy stopped or confirmation unavailable: ${String(error.message || error)}`);
    } finally {
      appState.fundedBuyBusy = false;
      appState.renderFundedBuyControl();
    }
  }
  // app-source-end

  // app-source: 354
  function renderBuybackDashboard(message = ''){
    return appState.renderBuybackDashboardView(message, { connectedWalletAddress: appState.connectedWalletAddress, fundedBurnState: appState.fundedBurnState, verifiedLaunchPolicies: appState.verifiedLaunchPolicies, buybackNetworkState: appState.buybackNetworkState, verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, wallet: appState.wallet, LAUNCH_BURN_TIERS: appState.LAUNCH_BURN_TIERS, SELECTABLE_LAUNCH_TIERS: appState.SELECTABLE_LAUNCH_TIERS }, { getBuybackPreviewState: appState.getBuybackPreviewState, formatBuybackAmount: appState.formatBuybackAmount, fundedReceiptProject: appState.fundedReceiptProject, renderBuybackExample: appState.renderBuybackExample, updateFundedBurnButton: appState.updateFundedBurnButton, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 355
  async function submitFundedBurn(){
    if (!appState.wallet) { await appState.connectWallet(); if (!appState.wallet) return; }
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) { appState.fundedBurnState.message = 'Open this page in a signing wallet to burn $FUNDED.'; appState.renderBuybackDashboard(); return; }
    const input = document.querySelector('#funded-burn-amount');
    const projectMint = document.querySelector('#funded-burn-project')?.value || null;
    let amount;
    try {
      amount = appState.parseTokenAmount(input.value, appState.fundedBurnState.decimals);
      if (amount > appState.fundedBurnState.balanceBaseUnits) throw new Error('The burn amount exceeds this wallet’s $FUNDED balance.');
    } catch (error) { appState.fundedBurnState.message = error.message; appState.renderBuybackDashboard(); return; }
    let burnPlan;
    try { burnPlan = appState.planTokenAccountBurns(appState.fundedBurnState.tokenAccounts, amount); }
    catch (error) { appState.fundedBurnState.message = error.message; appState.renderBuybackDashboard(); return; }
    const button = document.querySelector('#funded-burn-submit');
    const previousSupply = appState.fundedBurnState.supplyBaseUnits;
    appState.fundedBurnState.status = 'submitting';
    appState.fundedBurnState.message = 'Review and approve the permanent burn in your wallet.';
    button.textContent = 'Awaiting approval…';
    appState.renderBuybackDashboard();
    try {
      const { PublicKey, Transaction, TransactionInstruction, createBurnCheckedInstruction, getAccount, getMint } = await appState.getSolana();
      appState.assertWalletSessionCurrent(session);
      const mint = new PublicKey(appState.PROTOCOL_FUNDED_MINT);
      const latest = await appState.connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({ feePayer: session.provider.publicKey, recentBlockhash: latest.blockhash });
      for (const burn of burnPlan) transaction.add(
        createBurnCheckedInstruction(burn.address, mint, session.provider.publicKey, burn.amount, appState.fundedBurnState.decimals, [], appState.fundedBurnState.tokenProgram),
      );
      if (projectMint) transaction.add(new TransactionInstruction({
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: appState.Buffer.from(appState.projectBurnMemo(projectMint), 'utf8'),
      }));
      const signed = await session.provider.signTransaction(transaction);
      appState.assertWalletSessionCurrent(session);
      const signature = await appState.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      appState.fundedBurnState.message = `Burn submitted (${signature.slice(0, 8)}…). Waiting for Solana confirmation.`;
      appState.renderBuybackDashboard();
      const confirmation = await appState.waitForSignatureConfirmation(appState.connection, { signature, lastValidBlockHeight: latest.lastValidBlockHeight });
      if (confirmation.value.err) throw new Error(`Burn transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      const [accountResults, mintAfter] = await Promise.all([
        Promise.all(burnPlan.map(async burn => ({ burn, account: await getAccount(appState.connection, burn.address, 'confirmed', appState.fundedBurnState.tokenProgram) }))),
        getMint(appState.connection, mint, 'confirmed', appState.fundedBurnState.tokenProgram),
      ]);
      const accountDelta = accountResults.reduce((total, { burn, account }) => {
        const before = appState.fundedBurnState.tokenAccounts.find(item => item.address.equals(burn.address))?.amount;
        return before == null ? total : total + (before - account.amount);
      }, 0n);
      if (accountDelta !== amount || previousSupply - mintAfter.supply !== amount) throw new Error(`Burn confirmed as ${signature}, but the expected balance and supply deltas were not observed.`);
      const indexed = await appState.apiRequest('/api/burn-receipts', { method: 'POST', body: { signature, wallet: session.address, amountBaseUnits: amount.toString(), projectMint } });
      appState.fundedBurnState.message = indexed.available ? `Burn confirmed: ${signature}` : `Burn confirmed on Solana. Burn history is temporarily unavailable: ${signature}`;
      input.value = '';
      appState.showToast('Burn confirmed on Solana');
      appState.fundedBurnState.status = 'idle';
      await appState.loadFundedBurnState({ force: true });
    } catch (error) {
      appState.fundedBurnState.status = 'ready';
      appState.fundedBurnState.message = `Burn stopped or confirmation unavailable: ${error.message}`;
      appState.renderBuybackDashboard();
    } finally { button.textContent = 'Burn $FUNDED'; appState.updateFundedBurnButton(); }
  }
  // app-source-end

  return { renderFundedBuyControl, refreshFundedBuyRoute, handleFundedBuy, renderBuybackDashboard, submitFundedBurn };
}
