import { refreshServiceFees, appTradeBps, appTradeRecipient } from '../fees/service-fees-client.js';
import { assertTradeLimits } from '../experience/trade-preferences.js';
import { recordTradeRecovery } from '../experience/trade-recovery-store.js';

// Quick buy from a token card: builds the same route as the trade panel (direct
// Pump curve or Jupiter, with the app fee and transaction checks) and opens the
// wallet to approve, without leaving the current page.
let busy = false;
export async function quickBuy(app, { mint, amountSol, symbol = '', dexId = '', quoteMint = '', button = null }) {
  if (busy) return;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '') || !(Number(amountSol) > 0)) return;
  busy = true;
  const label = button?.textContent;
  const setLabel = text => { if (button) button.textContent = text; };
  const ticker = symbol ? `$${String(symbol).replace(/^\$/, '')}` : 'this token';
  try {
    if (!app.wallet) await app.connectWallet();
    const session = app.captureWalletSession?.();
    if (!session?.provider || !app.canSignTransactions?.(session.provider)) throw new Error('Connect a wallet that can sign transactions to buy.');
    if (session.provider.remoteMobile) throw new Error('Open richpad.fun inside the Phantom app to buy with your phone wallet.');
    setLabel('Preparing…');
    await refreshServiceFees(app);
    const lazy = await import('./lazy-trading.js');
    if (dexId) lazy.setTradeVenueHint?.(mint, dexId);
    if (quoteMint) lazy.setTradeQuoteHint?.(mint, quoteMint);
    const connection = app.connection || (await app.getSolana(), app.connection);
    // Same default slippage as the trade panel, checked against the saved slippage cap.
    const slippagePercent = 1;
    assertTradeLimits({ slippagePercent });
    const balance = await connection.getBalance(session.provider.publicKey, 'confirmed');
    const needed = Math.ceil(Number(amountSol) * (1 + slippagePercent / 100 + appTradeBps(app) / 10_000) * 1e9) + 5_000_000;
    if (balance < needed) throw new Error(`Insufficient SOL: this buy needs up to ${(needed / 1e9).toFixed(4)} SOL; the wallet has ${(balance / 1e9).toFixed(4)} SOL.`);
    const common = { connection, provider: session.provider, side: 'buy', mint, user: session.provider.publicKey, amount: String(amountSol), slippagePercent,
      feeOwner: appTradeRecipient(app), feeBps: appTradeBps(app) };
    const trade = await lazy.buildTradeTransaction(common);
    setLabel('Approve in wallet…');
    let pending = null;
    const result = await lazy.submitTrade({ ...common, preparedTrade: trade, tokenSymbol: symbol, tokenName: '',
      assertWalletCurrent: () => app.assertWalletSessionCurrent?.(session),
      onPrepared: ({ signature, lastValidBlockHeight }) => {
        pending = { signature, lastValidBlockHeight, mint, side: 'buy', walletAddress: session.address, feeLamports: trade.feeLamports, broadcastUncertain: true, progress: 'signed' };
        recordTradeRecovery(pending);
      },
      onStatus: () => {} });
    if (pending) recordTradeRecovery({ ...pending, state: 'verified', broadcastUncertain: false });
    app.showToast?.(`Bought ${ticker} with ${amountSol} SOL. Confirmed on Solana.`);
    void app.refreshWalletInfo?.(); void app.refreshPortfolioHoldings?.();
    // Offer a call right after a confirmed buy, as on the token page.
    void import('../callouts/post-buy-call.js').then(module => module.showPostBuyCall({ mint, symbol, app })).catch(() => {});
    return result;
  } catch (error) {
    const message = String(error?.message || error || 'The buy could not be completed.');
    app.showToast?.(/reject|declin|cancel/i.test(message) ? 'Buy cancelled in the wallet. Nothing was spent.' : message);
    void app.apiRequest?.('/api/client-errors', { method: 'POST', body: { area: 'quick-buy', side: 'buy', mint, message: message.slice(0, 300) } }).catch(() => {});
  } finally {
    busy = false;
    if (button && label != null) button.textContent = label;
  }
}
