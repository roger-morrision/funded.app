import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeTradeExecution(appState) {
  // app-source: 571
  document.querySelector('#trade-verify')?.addEventListener('click', event => {
    const signature = event.currentTarget.dataset.pendingSignature || null;
    void appState.verifyPendingTrade(null, signature).catch(error => {
      const pending = signature ? appState.pendingTradeVerifications.get(signature) : appState.pendingTradeVerifications.values().next().value;
      if (pending) appState.setTradeReceiptStatus(`Trade verification is unavailable: ${error.message}. Check status again later.`, pending.signature);
    });
  });
  // app-source-end

  // app-source: 572
  document.querySelector('#trade-share')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const session = appState.captureWalletSession();
    if (!session || session.address !== button.dataset.wallet || !button.dataset.signature) return appState.setTradeStatus('Reconnect the trading wallet to share this receipt.', true);
    button.disabled = true;
    try {
      const activeConnection = appState.connection || (await appState.getSolana(), appState.connection);
      const tx = await activeConnection.getParsedTransaction(button.dataset.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
      if (!appState.verifiedTradeReceipt(tx, { wallet:session.address, mint:button.dataset.mint, side:button.dataset.side, signature:button.dataset.signature })) throw new Error('The finalized trade receipt is not available or does not match this wallet and token yet. Try again later.');
      if (!appState.isWalletSessionCurrent(session)) return;
      // Card figures from the finalized receipt: token quantity, SOL moved and, for a
      // sell with a remembered buy, realized P&L against that buy's cost.
      const figures = tx => {
        const keys = tx?.transaction?.message?.accountKeys || [], index = keys.findIndex(key => String(key.pubkey || key) === session.address);
        const tokens = balances => (balances || []).filter(row => row.owner === session.address && row.mint === button.dataset.mint)
          .reduce((sum, row) => sum + Number(row.uiTokenAmount?.uiAmountString || 0), 0);
        return { tokens: Math.abs(tokens(tx?.meta?.postTokenBalances) - tokens(tx?.meta?.preTokenBalances)),
          sol: index >= 0 ? Math.abs(tx.meta.postBalances[index] - tx.meta.preBalances[index]) / 1e9 : NaN };
      };
      const own = figures(tx);
      let pnlSol = NaN, pnlPercent = NaN;
      const saved = button.dataset.side === 'sell' ? appState.savedRoundTrip(session.address, button.dataset.mint) : null;
      if (saved?.buySignature) {
        const bought = figures(await activeConnection.getParsedTransaction(saved.buySignature, { commitment:'finalized', maxSupportedTransactionVersion:0 }).catch(() => null));
        if (bought.tokens > 0 && bought.sol > 0) { const cost = bought.sol * Math.min(1, own.tokens / bought.tokens); pnlSol = own.sol - cost; pnlPercent = pnlSol / cost * 100; }
      }
      const identity = await appState.apiRequest(`/api/tokens/market?mints=${encodeURIComponent(button.dataset.mint)}`, { signal:AbortSignal.timeout(6000) }).catch(() => null);
      const info = identity?.data?.items?.find(row => row.mint === button.dataset.mint) || {};
      // Same-origin logo route: third-party logo hosts would taint the share card canvas.
      const logoImage = await new Promise(resolve => { const image = new Image(); image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = `/api/tokens/${encodeURIComponent(button.dataset.mint)}/logo`; setTimeout(() => resolve(null), 5000); });
      const symbol = info.symbol || button.dataset.symbol;
      const url = new URL(`/token/${encodeURIComponent(button.dataset.mint)}`, location.origin);
      const code = appState.registeredShareCode(); if (code) url.searchParams.set('ref', code);
      appState.openShareComposer({ kind:'trade', title:'Finalized Solana trade on richpad.fun',
        text:`${button.dataset.side === 'buy' ? 'Bought' : 'Sold'} ${own.tokens ? own.tokens.toLocaleString('en-US', { maximumFractionDigits:2 }) + ' ' : ''}$${symbol || 'TOKEN'} on richpad.fun ${button.dataset.side === 'buy' ? '🚀' : '💰'}${Number.isFinite(own.sol) && own.sol > 0 ? `\n${button.dataset.side === 'buy' ? 'Spent' : 'Received'} ${own.sol.toFixed(4)} SOL` : ''}${Number.isFinite(pnlSol) ? ` · P&L ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL${Number.isFinite(pnlPercent) ? ` (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)` : ''}` : ''}\nCA: ${button.dataset.mint}`, url:url.toString(),
        result:{ kind:'trade', verified:true, side:button.dataset.side, mint:button.dataset.mint, tokenSymbol:symbol, tokenAmount:own.tokens, solAmount:own.sol, pnlSol, pnlPercent, logoImage,
          receipt:button.dataset.signature, receiptUrl:appState.exploreExplorer(`tx/${encodeURIComponent(button.dataset.signature)}`), wallet:session.address, network:appState.EXPLORE_CLUSTER } });
    } catch (error) { appState.setTradeStatus(error.message || 'Trade receipt verification is unavailable.', true); }
    finally { button.disabled = false; }
  });
  // app-source-end

  // app-source: 573
  document.querySelector('#trade-roundtrip-share')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const session = appState.captureWalletSession(), mint = document.querySelector('#trade-mint')?.value.trim();
    const pair = session && mint ? appState.savedRoundTrip(session.address, mint) : null;
    if (!session || !mint || !pair?.buySignature || !pair?.sellSignature) return appState.setTradeStatus('A finalized in-app buy and sell pair is required.', true);
    button.disabled = true;
    try {
      const { formatLamportsAsSol, verifyRoundTripFromSignatures } = await import('../../../trade-roundtrip.js');
      const activeConnection = appState.connection || (await appState.getSolana(), appState.connection);
      const proof = await verifyRoundTripFromSignatures(activeConnection, { buySignature:pair.buySignature, sellSignature:pair.sellSignature, mint, wallet:session.address });
      if (!proof.positive) throw new Error('The two receipts do not show a positive wallet SOL change. You can still share the individual trade receipt.');
      if (!appState.isWalletSessionCurrent(session) || document.querySelector('#trade-mint')?.value.trim() !== mint) return;
      const netSol = formatLamportsAsSol(proof.netLamports);
      const url = new URL(`/token/${encodeURIComponent(mint)}`, location.origin);
      url.searchParams.set('buy', pair.buySignature);
      url.searchParams.set('sell', pair.sellSignature);
      const code = appState.registeredShareCode(); if (code) url.searchParams.set('ref', code);
      appState.openShareComposer({ kind:'roundtrip', title:'Verified closed trade on richpad.fun',
        publicShareApproval:{ assertCurrent:()=>appState.assertWalletSessionCurrent(session), sign:async statement=>{
          appState.assertWalletSessionCurrent(session);
          if (typeof session.provider.signMessage !== 'function') throw new Error('Use a wallet that supports message signing.');
          const signed=await session.provider.signMessage(new TextEncoder().encode(statement));
          appState.assertWalletSessionCurrent(session);
          return appState.bs58.encode(signed.signature || signed);
        } },
        text:`My closed ${pair.symbol || 'token'} trade changed my wallet SOL balance by +${netSol} SOL across its buy and sell receipts. Includes all SOL movements in those transactions; not wallet-wide profit. Verify both receipts.`, url:url.toString(),
        result:{ kind:'roundtrip', verified:true, accountHistoryVerified:true, netLamports:proof.netLamports, mint,
          buyReceipt:pair.buySignature, buyReceiptUrl:appState.exploreExplorer(`tx/${encodeURIComponent(pair.buySignature)}`),
          receipt:pair.sellSignature, receiptUrl:appState.exploreExplorer(`tx/${encodeURIComponent(pair.sellSignature)}`),
          wallet:session.address, network:appState.EXPLORE_CLUSTER } });
    } catch (error) { appState.setTradeStatus(error.message || 'Closed trade verification is unavailable.', true); }
    finally { button.disabled = false; }
  });
  // app-source-end

  // app-source: 574
  const infoDialogRoutes = new Set(['terms', 'disclosures', 'opt-out']);
  initializeAppState(appState, 'infoDialogRoutes', infoDialogRoutes);
  // app-source-end

}
