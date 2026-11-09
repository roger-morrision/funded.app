import { createBurnRecovery, readPendingBurn, savePendingBurn } from '../../features/funded/burn-recovery.js';
import { fundedBuyFailureMessage, fundedBurnFailureMessage } from '../../features/funded/buy-feedback.js';
import {createFundedBuyQuotes,currentFundedBuyQuote,FUNDED_BUY_QUOTE_TTL} from '../../features/funded/buy-quotes.js';
// Dependencies and mutable application state are read live through appState.
export function createFundedTradingController(appState) {
  const burnRecovery = createBurnRecovery(appState);
  const buyQuotes = createFundedBuyQuotes(appState);
  // app-source: 351
  function renderFundedBuyControl(message = null){
    const input = document.querySelector('#funded-buy-amount');
    const button = document.querySelector('#funded-buy-submit');
    const badge = document.querySelector('#funded-buy-route-state');
    const status = document.querySelector('#funded-buy-status');
    if (!input || !button || !badge || !status) return;
    const dialogClose = document.querySelector('#funded-buy-dialog .funded-buy-close');
    if (dialogClose) dialogClose.disabled = appState.fundedBuyBusy;
    const ready = appState.fundedBuyRoute.status === 'ready';
    const amount = Number(input.value);
    const preview = currentFundedBuyQuote(appState,amount);
    input.disabled = !ready || appState.fundedBuyBusy;
    button.disabled = !ready || appState.fundedBuyBusy || !Number.isFinite(amount) || amount <= 0 || !preview;
    button.textContent = appState.fundedBuyBusy ? 'Waiting for Solana…' : appState.wallet ? 'Buy $RICH' : 'Connect wallet to buy';
    badge.textContent = ready ? 'Solana pool live' : appState.fundedBuyRoute.status === 'checking' ? 'Checking' : 'Unavailable';
    badge.classList.toggle('unavailable', !ready);
    const clock = document.querySelector('#funded-buy-countdown');
    if (clock) clock.textContent = preview && !appState.fundedBuyBusy ? 'Auto-refreshing quote · 1% slippage' : '';
    const estimate = document.querySelector('#funded-buy-estimate');
    if (estimate) {
      estimate.hidden = !preview?.quote;
      if (preview?.quote) {
        const q=preview.quote, tokens=value=>value.toLocaleString(undefined,{maximumFractionDigits:6});
        estimate.querySelector('[data-buy-receive]').textContent=`${tokens(q.expected)} $RICH`;
        estimate.querySelector('[data-buy-minimum]').textContent=`${tokens(q.minimum)} $RICH`;
        estimate.querySelector('[data-buy-spend]').textContent=`${q.maximumSpendSol.toFixed(6)} SOL`;
        estimate.querySelector('[data-buy-fee]').textContent=`${q.appFeeSol.toFixed(6)} SOL`;
      }
    }
    if (message != null) status.textContent = message;
    else if (!ready) status.textContent = appState.fundedBuyRoute.reason;
  }
  // app-source-end

  // app-source: 352
  async function refreshFundedBuyRoute(signal){
    try {
      if (appState.APP_CLUSTER !== 'devnet' || appState.APP_MAINNET_READ_ONLY || !appState.PROTOCOL_FUNDED_MINT || !appState.PROTOCOL_FUNDED_SWAP_POOL) throw new Error('A Solana $RICH mint and pool are required.');
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
      appState.renderHomeKpiDashboard();
      if (globalThis.document?.querySelector('#funded-buy-amount')) buyQuotes.invalidate();
    } catch (error) {
      signal?.throwIfAborted();
      if (appState.fundedBuyBusy) return;
      appState.fundedBuyPreview = null;
      const reason = fundedBuyFailureMessage(error);
      appState.fundedBuyRoute = { status:'unavailable', snapshot:null, reason };
      appState.renderFundedBuyControl();
      appState.renderFundedTokenLanding();
      appState.renderHomeKpiDashboard();
    }
  }
  // app-source-end

  // app-source: 353
  async function handleFundedBuy(){
    if (appState.fundedBuyBusy || appState.fundedBuyRoute.status !== 'ready') return;
    const amount = Number(document.querySelector('#funded-buy-amount')?.value);
    if (!Number.isFinite(amount) || amount <= 0) return appState.renderFundedBuyControl('Enter a positive SOL amount.');
    if (!appState.wallet) { await appState.connectWallet(); buyQuotes.invalidate(); return; }
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) return appState.renderFundedBuyControl('Open the app in a wallet that can sign Solana transactions.');
    const preview = currentFundedBuyQuote(appState,amount);
    if (!preview?.trade?.instructions) { buyQuotes.invalidate(); return; }
    appState.fundedBuyBusy = true;
    buyQuotes.pause();
    appState.renderFundedBuyControl();
    let submittedSignature = null;
    try {
      const rpc = await appState.getTradePreviewConnection();
      appState.assertWalletSessionCurrent(session);
      const { PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await appState.getSolana();
      const mint = new PublicKey(appState.PROTOCOL_FUNDED_MINT);
      const mintInfo = await rpc.getAccountInfo(mint, 'finalized');
      if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('The $RICH mint is not a verified SPL mint.');
      const tokenAccount = getAssociatedTokenAddressSync(mint, session.provider.publicKey, false, mintInfo.owner);
      const beforeAccount = await rpc.getAccountInfo(tokenAccount, 'finalized');
      const before = beforeAccount ? BigInt((await rpc.getTokenAccountBalance(tokenAccount, 'finalized')).value.amount) : 0n;
      appState.assertWalletSessionCurrent(session);
      if (Date.now()-preview.preparedAt >= FUNDED_BUY_QUOTE_TTL) {
        appState.fundedBuyBusy=false;buyQuotes.invalidate();return;
      }
      const preparedTrade = preview.trade;
      appState.fundedBuyPreview = null;
      const result = await appState.submitTrade({ connection:rpc, provider:session.provider, side:'buy', mint, user:session.provider.publicKey, amount, slippagePercent:1, feeOwner:preparedTrade.feePolicy.feeOwner, feeBps:preparedTrade.feePolicy.feeBps, preparedTrade, tokenName:'RICH', tokenSymbol:'RICH', assertWalletCurrent:()=>appState.assertWalletSessionCurrent(session), onStatus:appState.renderFundedBuyControl });
      submittedSignature = result.signature;
      await appState.waitForSignatureConfirmation(rpc, { signature:result.signature, commitment:'finalized' });
      appState.assertWalletSessionCurrent(session);
      const after = BigInt((await rpc.getTokenAccountBalance(tokenAccount, 'finalized')).value.amount);
      const minimum = BigInt((result.minimumOutputAmount || result.outputAmount).toString());
      if (after - before < minimum) throw new Error(`Transaction ${result.signature} finalized, but the expected $RICH balance increase was not observed.`);
      document.querySelector('#funded-buy-amount').value = '';
      appState.renderFundedBuyControl(`Buy finalized: ${result.signature}. Received ${Number(after - before) / 10 ** result.tokenDecimals} $RICH.`);
      appState.showToast('Verified $RICH buy finalized on Solana');
      void appState.loadFundedBurnState({ force:true });
    } catch (error) {
      appState.fundedBuyPreview = null;
      appState.renderFundedBuyControl(error.signature || submittedSignature
        ? `Confirmation is uncertain for ${error.signature || submittedSignature}. Check that signature on Solana before trying again.`
        : fundedBuyFailureMessage(error, 'buy'));
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
    if (appState.fundedBurnBusy) return;
    if (readPendingBurn()) return burnRecovery.check();
    if (!appState.wallet) { await appState.connectWallet(); if (!appState.wallet) return; }
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) { appState.fundedBurnState.message = 'Open this page in a signing wallet to burn $RICH.'; appState.renderBuybackDashboard(); return; }
    const input = document.querySelector('#funded-burn-amount');
    const projectMint = document.querySelector('#funded-burn-project')?.value || null;
    let amount;
    try {
      amount = appState.parseTokenAmount(input.value, appState.fundedBurnState.decimals);
      if (amount > appState.fundedBurnState.balanceBaseUnits) throw new Error('The burn amount exceeds this wallet’s $RICH balance.');
    } catch (error) { appState.fundedBurnState.message = error.message; appState.renderBuybackDashboard(); return; }
    let burnPlan;
    try { burnPlan = appState.planTokenAccountBurns(appState.fundedBurnState.tokenAccounts, amount); }
    catch (error) { appState.fundedBurnState.message = error.message; appState.renderBuybackDashboard(); return; }
    const button = document.querySelector('#funded-burn-submit');
    const { decimals, tokenProgram } = appState.fundedBurnState;
    appState.fundedBurnBusy = true;
    appState.fundedBurnState.status = 'submitting';
    appState.fundedBurnState.message = 'Review and approve the permanent burn in your wallet.';
    button.textContent = 'Awaiting approval…';
    appState.renderBuybackDashboard();
    let submittedBurnSignature = null;

    try {
      const { PublicKey, Transaction, TransactionInstruction, createBurnCheckedInstruction } = await appState.getSolana();
      appState.assertWalletSessionCurrent(session);
      const mint = new PublicKey(appState.PROTOCOL_FUNDED_MINT);
      const latest = await appState.connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({ feePayer: session.provider.publicKey, recentBlockhash: latest.blockhash });
      for (const burn of burnPlan) transaction.add(
        createBurnCheckedInstruction(burn.address, mint, session.provider.publicKey, burn.amount, decimals, [], tokenProgram),
      );
      if (projectMint) transaction.add(new TransactionInstruction({
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: appState.Buffer.from(appState.projectBurnMemo(projectMint), 'utf8'),
      }));
      const signed = await session.provider.signTransaction(transaction);
      appState.assertWalletSessionCurrent(session);
      if (!signed.signature || signed.signature.length !== 64) throw new Error('Wallet returned an unsigned burn. No burn was sent.');
      const signature = appState.bs58.encode(signed.signature);
      const pending = { cluster:'devnet', signature, wallet:session.address, fundedMint:appState.PROTOCOL_FUNDED_MINT,
        amountBaseUnits:amount.toString(), projectMint, lastValidBlockHeight:latest.lastValidBlockHeight };
      savePendingBurn(pending);
      submittedBurnSignature = signature;
      await appState.connection.sendRawTransaction(signed.serialize(), { skipPreflight:false, maxRetries:3 });
      appState.fundedBurnState.message = `Burn submitted (${signature.slice(0, 8)}...). Waiting for finalization.`;
      appState.renderBuybackDashboard();
      await appState.waitForSignatureConfirmation(appState.connection, { signature, commitment:'finalized', lastValidBlockHeight:latest.lastValidBlockHeight });
      await burnRecovery.reconcile(pending);
    } catch (error) {
      if (appState.connectedWalletAddress !== session.address) return;
      appState.fundedBurnState.status = 'ready';
      const signature = error.signature || submittedBurnSignature;
      appState.fundedBurnState.message = signature
        ? `Burn verification is pending: ${signature}. Use Check burn status to verify the original receipt.`
        : fundedBurnFailureMessage(error);
      appState.renderBuybackDashboard();
    } finally { appState.fundedBurnBusy = false; appState.updateFundedBurnButton(); }
  }
  // app-source-end

  return { renderFundedBuyControl, refreshFundedBuyRoute, handleFundedBuy, refreshFundedBuyQuote:buyQuotes.refresh, invalidateFundedBuyQuote:buyQuotes.invalidate, renderBuybackDashboard, submitFundedBurn };
}
