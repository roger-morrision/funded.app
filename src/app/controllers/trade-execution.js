import { refreshServiceFees, appTradeBps, appTradeRecipient } from '../../features/fees/service-fees-client.js';
import { recordFlowTiming } from '../../features/experience/flow-timing.js';
import { estimateTradeNetworkFee } from '../../features/experience/trade-costs.js';
import { recordTradeRecovery,uncertainTrade } from '../../features/experience/trade-recovery-store.js';
import {expiredUnlandedTrade} from '../../features/experience/trade-expiry.js';
import {createTradeQuoteRetry} from '../../features/experience/trade-quote-retry.js';
import {tradeRecoveryCopy,tradeVerificationUnavailable} from '../../features/experience/trade-progress.js';
import { assertTradeLimits, readTradePreferences } from '../../features/experience/trade-preferences.js';
import { TRADE_QUOTE_TTL_MS, TRADE_QUOTE_REFRESH_MS, TRADE_SIGNING_REFRESH_AFTER_MS } from '../../../trade-quote-policy.js';
import { tradeTokenSymbol } from '../../../trade-quote-display.js';
import { serverCoinIdentity } from '../../features/coin/server-identity.js';
import {buildRichTradeTransaction} from '../../features/trade/lazy-trading.js';
// Dependencies and mutable application state are read live through appState.
export function createTradeExecutionController(appState) {
  let retryInputKey='', quoteSeen=false;
  const verificationInFlight=new Set();
  const quoteRetry=createTradeQuoteRetry(globalThis.document?.querySelector('#trade-quote-retry'),{
    isCurrent:()=>!appState.tradeActionBusy&&retryInputKey===JSON.stringify({...appState.tradeInputs(),wallet:appState.connectedWalletAddress}),
    retry:()=>{if(holdUncertainTrade(appState.tradeInputs().mint))return;appState.invalidateTradePreview();appState.queueTradeQuote(0);}
  });
  // app-source: 565
  function queueTradeQuote(delay = 350){
    clearTimeout(appState.tradeQuoteTimer);
    if (holdUncertainTrade(appState.tradeInputs().mint)) return;
    if (!appState.tradeInputs().valid || !appState.wallet || !appState.canSignTransactions(appState.wallet) || document.visibilityState === 'hidden' || document.querySelector('#trade-panel')?.hidden) return;
    appState.tradeQuoteTimer = setTimeout(() => { void appState.prepareTradeQuote().catch(() => {}); }, delay);
  }
  // app-source-end

  // app-source: 566
  function refreshTradeQuoteWhenIdle(version){
    if (version !== appState.tradeQuoteVersion) return;
    if (appState.tradeActionBusy) {
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
    if (holdUncertainTrade(mint)) return null;
    if (!valid) throw new Error('Enter a positive amount and slippage between 0.1% and 10%.');
    assertTradeLimits({slippagePercent});
    if (!appState.wallet && connectIfNeeded) await appState.connectWallet();
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) throw new Error('Connect a signing wallet to calculate the trade quote.');
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
    if (appState.tradePreview?.inputKey === inputKey && Date.now() - appState.tradePreview.preparedAt < TRADE_QUOTE_TTL_MS) return appState.tradePreview;
    if (appState.tradeQuoteInFlight?.inputKey === inputKey && appState.tradeQuoteInFlight.version === appState.tradeQuoteVersion) return appState.tradeQuoteInFlight.promise;
    const version = appState.tradeQuoteVersion;
    const started = performance.now(), temperature = quoteSeen ? 'warm' : 'cold'; quoteSeen = true;
    const request = (async () => {
      quoteRetry.reset();
      appState.setTradeStatus('Calculating the current on-chain quote…');
      await refreshServiceFees(appState); appState.assertWalletSessionCurrent(session);
      const previewConnection = await appState.getTradePreviewConnection();
      appState.assertWalletSessionCurrent(session);
      // Mainnet $RICH without a configured PumpSwap pool trades through Jupiter like any token.
      const rich=mint===appState.PROTOCOL_FUNDED_MINT&&appState.APP_CLUSTER===appState.EXPLORE_CLUSTER&&!(appState.EXPLORE_CLUSTER==='mainnet-beta'&&!appState.PROTOCOL_FUNDED_SWAP_POOL);
      const builder=rich?buildRichTradeTransaction:appState.buildTradeTransaction;
      const trade = await builder({ connection: previewConnection, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: appTradeRecipient(appState), feeBps: appTradeBps(appState),
        ...(rich?{cluster:appState.APP_CLUSTER,poolAddress:appState.PROTOCOL_FUNDED_SWAP_POOL}:{}) });
      appState.assertWalletSessionCurrent(session);
      if (version !== appState.tradeQuoteVersion || !appState.tradeInputs().valid || `${appState.tradeInputs().mint}:${appState.tradeInputs().side}:${appState.tradeInputs().amount}:${appState.tradeInputs().slippagePercent}:${session.address}` !== inputKey) return null;
      const tokenSymbol = tradeTokenSymbol(mint, [
        appState.coinTradeEstimate, appState.coinSummaryLaunch,
        appState.verifiedLaunchPolicyForMint?.(mint),
        { mint, ...serverCoinIdentity(mint) },
        ...(appState.assets || []),
      ]);
      const quote = appState.describeTradeQuote(trade, slippagePercent, tokenSymbol);
      if (side === 'sell' && quote.minimumNetSol <= 0) throw new Error('The app fee would exceed the minimum SOL output. Increase the sell amount.');
      appState.tradePreview = { trade, inputKey, preparedAt: Date.now() };
      document.querySelector('#trade-live-countdown').innerHTML = appState.quoteCountdownMarkup(appState.tradePreview.preparedAt + TRADE_QUOTE_TTL_MS);
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
          ? `Gross ${quote.route === 'jupiter' ? 'swap' : 'Pump'} output: ${receiveText}. Estimated to wallet after app fee: ${quote.expectedNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL. Minimum after slippage and app fee: ${quote.minimumNetSol.toLocaleString('en-US', { maximumFractionDigits:9 })} SOL.`
          : `Estimated receive: ${receiveText}. Slippage floor: ${quote.minimum.toLocaleString('en-US', { maximumFractionDigits: outputDigits })} ${quote.outputSymbol}.`;
      const feeText = quote.maximumSpendSol != null
        ? `Maximum pool spend includes Pump pool fees. App fee: ${quote.appFeeSol.toFixed(9)} SOL, plus network/account costs.`
        : `App fee: ${quote.appFeeSol.toFixed(9)} SOL, plus network and ${quote.route === 'jupiter' ? 'pool' : 'Pump'} fees.`;
      document.querySelector('#trade-quote').textContent = `${quote.route === 'jupiter' ? `Jupiter${trade.routes?.length ? ` (${trade.routes.join(' → ')})` : ''}${trade.priceImpactPct > 0.01 ? ` · price impact ${(trade.priceImpactPct * 100).toFixed(2)}%` : ''}` : quote.route === 'graduated-pool' ? 'Graduated pool' : 'Pump curve'} · ${slippageText} ${feeText}`;
      appState.setTradeStatus('Review this quote and the transaction in your wallet before signing.');
      appState.productEvent('trade_quote_ready');
      recordFlowTiming('quote', performance.now()-started, 'available', temperature);
      appState.tradeQuoteTimer = setTimeout(() => appState.refreshTradeQuoteWhenIdle(version), TRADE_QUOTE_REFRESH_MS);
      return appState.tradePreview;
    })();
    appState.tradeQuoteInFlight = { inputKey, version, promise:request };
    try { return await request; }
    catch (error) {
      recordFlowTiming('quote', performance.now()-started, 'unavailable', temperature);
      if (version === appState.tradeQuoteVersion && appState.isWalletSessionCurrent(session)) {
        appState.tradePreview = null;
        appState.renderTradeBalances();
        const card = document.querySelector('#trade-live-estimate');
        card?.classList.add('is-unavailable');
        document.querySelector('#trade-live-amount').textContent = 'Quote unavailable';
        document.querySelector('#trade-live-detail').textContent = appState.tradePreviewFailureMessage(error, side);
        document.querySelector('#trade-quote').textContent = appState.tradePreviewFailureMessage(error, side);
        appState.setTradeStatus(appState.tradePreviewFailureMessage(error, side), true);
        retryInputKey=JSON.stringify({...appState.tradeInputs(),wallet:appState.connectedWalletAddress});
        quoteRetry.failed();
      }
      throw error;
    } finally { if (appState.tradeQuoteInFlight?.promise === request) appState.tradeQuoteInFlight = null; }
  }
  // app-source-end

  // app-source: 568
  function holdUncertainTrade(mint){
    const pending=uncertainTrade(appState.connectedWalletAddress,mint,appState.pendingTradeVerifications);
    if(!pending)return false;
    appState.pendingTradeVerifications.set(pending.signature,pending);
    quoteRetry.reset();
    const verify = document.querySelector('#trade-verify');
    if (verify) { verify.hidden = false; verify.dataset.pendingSignature = pending.signature; verify.textContent = 'Check recorded trade'; }
    appState.setTradeStatus('A signed trade needs verification. Use Check recorded trade before requesting another quote.');
    appState.setTradeReceiptStatus('Check this saved trade before preparing another trade for this coin.',pending.signature);
    return true;
  }
  async function requestTradeSignature(){
    if (appState.tradeActionBusy) return;
    const { mint, side, amount, slippagePercent, valid } = appState.tradeInputs();
    if(holdUncertainTrade(mint))return;
    if (!valid) return appState.setTradeStatus('Enter a positive amount and slippage between 0.1% and 10%.', true);
    // Give the wallet review a usable countdown even when the inline quote is
    // already near expiry. The refreshed quote is still checked before signing.
    if (appState.tradePreview && Date.now() - appState.tradePreview.preparedAt > TRADE_SIGNING_REFRESH_AFTER_MS)
      appState.invalidateTradePreview();
    appState.tradeActionBusy = true;
    appState.updateTradeActionState();
    const version = appState.tradeQuoteVersion;
    let readyToSign = false;
    try {
      const prepared = await appState.prepareTradeQuote({ connectIfNeeded:true });
      if (!prepared) return;
      assertTradeLimits({slippagePercent});
      if (version !== appState.tradeQuoteVersion) return;
      const session = appState.captureWalletSession();
      const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session?.address || ''}`;
      if (!session || prepared.inputKey !== inputKey || Date.now() - prepared.preparedAt > TRADE_QUOTE_TTL_MS) return;
      readyToSign = true;
    } catch (error) { if (version === appState.tradeQuoteVersion) appState.setTradeStatus(appState.tradePreviewFailureMessage(error, side), true); }
    finally { appState.tradeActionBusy = false; appState.updateTradeActionState(); }
    if (readyToSign && version === appState.tradeQuoteVersion) await executeTrade();
  }
  // app-source-end

  // app-source: 569
  async function executeTrade(){
    if (appState.tradeActionBusy) return;
    if (!appState.wallet) return appState.setTradeStatus('Connect a signing wallet to trade.', true);
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) return appState.setTradeStatus('Open this app in a signing wallet to trade.', true);
    const mint = document.querySelector('#trade-mint').value.trim(); const side = document.querySelector('#trade-side').value;
    if(holdUncertainTrade(mint))return;
    const amount = appState.parseTradeAmountInput(document.querySelector('#trade-amount').value); const slippagePercent = Number(document.querySelector('#trade-slippage').value);
    if (!mint || !Number.isFinite(amount) || amount <= 0) { appState.setTradeStatus('Enter a valid mint and positive trade amount.', true); return; }
    if (!appTradeRecipient(appState)) { appState.setTradeStatus('Trading is disabled: configure VITE_FUNDED_TRADE_FEE_OWNER for the app owner.', true); return; }
    const inputKey = `${mint}:${side}:${amount}:${slippagePercent}:${session.address}`;
    if (!appState.tradePreview || appState.tradePreview.inputKey !== inputKey || Date.now() - appState.tradePreview.preparedAt > TRADE_QUOTE_TTL_MS) {
      appState.invalidateTradePreview();
      appState.setTradeStatus('The quote changed or expired. Refreshing it; select Buy or Sell again when ready.');
      appState.queueTradeQuote(0);
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
        if (!appState.hasBuyBalance(latestBalance, { amountSol:amount, slippagePercent, feeBps:appTradeBps(appState), trade:appState.tradePreview.trade })) throw new Error('Insufficient SOL for maximum spend, app fee, and network/account allowance.');
      }
      appState.assertWalletSessionCurrent(session);
      if (!appState.currentTradePreview()) throw new Error('The trade quote expired during balance verification. Review a fresh quote.');
      const limits=readTradePreferences();
      const networkFee=limits.maximumNetworkSol?await estimateTradeNetworkFee(appState,appState.tradePreview.trade):null;
      assertTradeLimits({slippagePercent,networkFeeLamports:networkFee},limits,{checkNetwork:true});
      appState.assertWalletSessionCurrent(session);
      if(!appState.currentTradePreview())throw new Error('The trade quote expired during fee verification. Review a fresh quote.');
      assertTradeLimits({slippagePercent,networkFeeLamports:networkFee},readTradePreferences(),{checkNetwork:true});
      const shownCoin = appState.getCoinMintAddress() === mint;
      const result = await appState.submitTrade({ connection: activeConnection, provider: session.provider, side, mint, user: session.provider.publicKey, amount, slippagePercent, feeOwner: appTradeRecipient(appState), feeBps: appTradeBps(appState), preparedTrade: appState.tradePreview.trade, tokenName:shownCoin ? document.querySelector('#coin-page-title')?.textContent?.trim() : '', tokenSymbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent?.trim() : '', assertWalletCurrent: () => appState.assertWalletSessionCurrent(session), onPrepared: ({signature,lastValidBlockHeight})=>{
        appState.assertWalletSessionCurrent(session);
        submittedSignature=signature;
        const pending={signature,lastValidBlockHeight,mint,side,walletAddress:session.address,feeLamports:appState.tradePreview.trade.feeLamports,broadcastUncertain:true,progress:'signed'};
        recordTradeRecovery(pending);appState.pendingTradeVerifications.set(signature,pending);
      },onStatus: message => { if (appState.isWalletSessionCurrent(session)) appState.setTradeStatus(message); } });
      submittedSignature = result.signature;
      const recovery = {signature:submittedSignature,lastValidBlockHeight:result.lastValidBlockHeight,broadcastUncertain:false,progress:'confirmed',mint,side,walletAddress:session.address,symbol:shownCoin ? document.querySelector('#coin-symbol')?.textContent : 'token',feeLamports:result.feeLamports};
      recordTradeRecovery(recovery); appState.pendingTradeVerifications.set(submittedSignature,recovery);
      if(appState.isWalletSessionCurrent(session))appState.setTradeReceiptStatus('Trade confirmed on Solana. Waiting for finalization, then checking token balance change and trade history.', submittedSignature);
      const finalization = await appState.waitForSignatureConfirmation(activeConnection, { signature:submittedSignature, commitment:'finalized' });
      if (finalization.value?.err) { const failure = new Error('The submitted transaction failed on-chain.'); failure.finalizedFailure = true; throw failure; }
      if (!appState.isWalletSessionCurrent(session)) return;
      appState.pendingTradeVerifications.set(submittedSignature, { signature:submittedSignature, mint, side, walletAddress:session.address,
        symbol:shownCoin ? (document.querySelector('#coin-symbol')?.textContent?.trim() || 'token') : 'token', feeLamports:result.feeLamports,lastValidBlockHeight:result.lastValidBlockHeight,broadcastUncertain:false,progress:'confirmed' });
      appState.setTradeReceiptStatus(`${side === 'buy' ? 'Buy' : 'Sell'} finalized. Checking token balance change and indexed trade row.`, submittedSignature);
      await appState.verifyPendingTrade(activeConnection, submittedSignature);
      void appState.refreshTradeBalances();
    } catch (error) {
      const signature = submittedSignature || error.signature;
      if (signature) {
        const previous=appState.pendingTradeVerifications.get(signature);
        const recovery = {signature,mint,side,walletAddress:session.address,broadcastUncertain:previous?.broadcastUncertain??true,progress:previous?.progress||'signed',lastValidBlockHeight:error.lastValidBlockHeight??previous?.lastValidBlockHeight,feeLamports:appState.tradePreview?.trade?.feeLamports ?? null,state:error.finalizedFailure ? 'failed' : 'pending'};
        recordTradeRecovery(recovery); if (!error.finalizedFailure) appState.pendingTradeVerifications.set(signature,recovery); else appState.pendingTradeVerifications.delete(signature);
      }
      if (appState.isWalletSessionCurrent(session)) {
        const message = error.finalizedFailure
        ? 'Trade failed on-chain. Review the receipt before making another trade.'
        : signature ? tradeVerificationUnavailable(appState.pendingTradeVerifications.get(signature)||{})
          : error.code===4001 ? 'Wallet approval cancelled. No trade was submitted. Review the quote when you are ready.'
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
    const verificationKey=`${pending.walletAddress}:${pending.signature}`;
    if(verificationInFlight.has(verificationKey))return;
    verificationInFlight.add(verificationKey);
    const button = document.querySelector('#trade-verify');
    if (button) { button.hidden = false; button.disabled = true; button.dataset.pendingSignature = pending.signature; button.textContent='Checking…'; }
    try {
      const rpc = activeConnection || appState.connection || (await appState.getSolana(), appState.connection);
      const [receipt, market] = await Promise.allSettled([
        rpc.getParsedTransaction(pending.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
        appState.apiRequest(`/api/tokens/${encodeURIComponent(pending.mint)}/market-activity`, { signal:AbortSignal.timeout(12000) }),
      ]);
      if (!appState.isWalletSessionCurrent(session) || appState.pendingTradeVerifications.get(pending.signature) !== pending) return;
      if(receipt.status==='fulfilled'&&receipt.value?.meta?.err!=null){appState.pendingTradeVerifications.delete(pending.signature);recordTradeRecovery({...pending,state:'failed'});appState.setTradeReceiptStatus('The transaction failed at finalized commitment. Inspect the signature before preparing another trade.',pending.signature,true);return;}
      if(receipt.status==='fulfilled'&&receipt.value===null&&await expiredUnlandedTrade(rpc,pending,null)){
        if(!appState.isWalletSessionCurrent(session)||appState.pendingTradeVerifications.get(pending.signature)!==pending)return;
        appState.pendingTradeVerifications.delete(pending.signature);recordTradeRecovery({...pending,state:'failed'});
        appState.setTradeReceiptStatus('Trade expired without landing. No replacement was submitted.',pending.signature,true);return;
      }
      const evidence = appState.assessTradeCompletion({ transaction:receipt.status === 'fulfilled' ? receipt.value : null,
        marketActivity:market.status === 'fulfilled' && market.value.available ? market.value.data : null,
        wallet:pending.walletAddress, mint:pending.mint, side:pending.side, signature:pending.signature });
      if(evidence.receiptVerified){
        pending.broadcastUncertain=false;pending.progress='indexing';recordTradeRecovery({...pending,broadcastUncertain:false,progress:'indexing'});
        if (appState.tradeInputs().mint === pending.mint) {
          appState.setTradeStatus('Trade finalized and balance change verified. Preparing the next quote.');
          if (!appState.tradeActionBusy) { appState.invalidateTradePreview(); appState.queueTradeQuote(0); }
        }
      }
      if(evidence.receiptVerified)void appState.apiRequest('/api/trades/finalized', {method:'POST',body:{
        signature:pending.signature,mint:pending.mint,wallet:pending.walletAddress},
        signal:AbortSignal.timeout(15000)}).catch(()=>{});
      if (!evidence.complete) {
        const reason = !evidence.receiptVerified
          ? receipt.status==='rejected'||pending.progress==='indexing'?tradeVerificationUnavailable(pending):'Finalized token balance change is not verified yet. Check this transaction again before retrying the trade.'
          : 'Trade finalized and token balance change verified. History indexing is pending; no need to submit this trade again.';
        appState.pendingTradeVerifications.delete(pending.signature);
        appState.pendingTradeVerifications.set(pending.signature, pending);
        appState.setTradeReceiptStatus(`${pending.side === 'buy' ? 'Buy' : 'Sell'}: ${reason}`, pending.signature);
        return;
      }
      appState.pendingTradeVerifications.delete(pending.signature);
      recordTradeRecovery({...pending,state:'verified'});
      if (button) button.hidden = appState.pendingTradeVerifications.size === 0;
      appState.setTradeReceiptStatus(`${pending.side === 'buy' ? 'Buy' : 'Sell'} finalized with verified balance change and indexed trade. App fee: ${pending.feeLamports==null?'Unavailable':(pending.feeLamports / 1_000_000_000).toFixed(9)+' SOL'}.`, pending.signature);
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
    } catch {
      if(appState.isWalletSessionCurrent(session)&&appState.pendingTradeVerifications.get(pending.signature)===pending)
        appState.setTradeReceiptStatus(tradeVerificationUnavailable(pending),pending.signature);
    } finally {
      verificationInFlight.delete(verificationKey);
      if (button && button.dataset.pendingSignature===pending.signature) {
        button.disabled = false;button.textContent=tradeRecoveryCopy(pending).action;
        if (!appState.pendingTradeVerifications.has(button.dataset.pendingSignature)) button.hidden = true;
      }
      appState.updateTradeActionState();
    }
  }
  // app-source-end

  return { queueTradeQuote, refreshTradeQuoteWhenIdle, prepareTradeQuote, requestTradeSignature, executeTrade, verifyPendingTrade };
}
