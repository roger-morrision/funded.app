import { APP_NET } from '../shared/app-network.js';
import { expiredUnlandedTrade } from '../experience/trade-expiry.js';

const KEY = 'funded.burn-recovery.devnet.v1';
const address = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value || '');
export function readPendingBurn(storage = globalThis.localStorage) {
  try {
    const row = JSON.parse(storage.getItem(KEY) || 'null');
    return row?.cluster === APP_NET && address(row.wallet) && address(row.fundedMint)
      && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature || '')
      && /^[1-9]\d*$/.test(row.amountBaseUnits || '')
      && (!row.projectMint || address(row.projectMint)) ? row : null;
  } catch { return null; }
}
export function savePendingBurn(row, storage = globalThis.localStorage) {
  // Store only the public receipt identity. Failure must happen BEFORE broadcast.
  storage.setItem(KEY, JSON.stringify(row));
  if (readPendingBurn(storage)?.signature !== row.signature) throw Error('Burn recovery could not be saved. No burn was sent.');
}
export function clearPendingBurn(row, storage = globalThis.localStorage) {
  if (readPendingBurn(storage)?.signature === row.signature) storage.removeItem(KEY);
}

export function createBurnRecovery(app) {
  let busy = false;
  const message = text => { app.fundedBurnState.message = text; app.renderBuybackDashboard(); };
  async function reconcile(row) {
    const indexed = await app.apiRequest('/api/burn-receipts', {
      method:'POST', body:row, signal:AbortSignal.timeout(30_000),
    });
    const proof = indexed.data;
    if (!indexed.available || proof?.status !== 'verified' || !proof.onchainVerified
      || proof.signature !== row.signature || proof.wallet !== row.wallet
      || proof.fundedMint !== row.fundedMint || proof.amountBaseUnits !== row.amountBaseUnits
      || (proof.projectMint || null) !== (row.projectMint || null)) throw Error('Burn receipt verification is pending.');
    // The server checks the finalized BurnChecked instruction and its transaction-local
    // pre/post balances. Global supply or a refreshed wallet snapshot is not that proof.
    clearPendingBurn(row);
    if (app.connectedWalletAddress !== row.wallet) return;
    document.querySelector('#funded-burn-amount').value = '';
    await app.loadFundedBurnState({ force:true });
    if (app.connectedWalletAddress !== row.wallet) return;
    message(`Burn finalized and recorded: ${row.signature}`);
    app.showToast('Burn finalized and recorded');
  }
  async function check() {
    const row = readPendingBurn();
    if (!row || busy) return;
    if (row.wallet !== app.connectedWalletAddress) {
      message(`Reconnect burn wallet ${row.wallet} to check its saved signature.`); return;
    }
    busy = true; app.fundedBurnBusy = true; app.updateFundedBurnButton();
    try {
      message(`Checking the original burn ${row.signature}. No new burn will be signed.`);
      const tx = await app.connection.getParsedTransaction(row.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
      if (tx?.meta?.err || await expiredUnlandedTrade(app.connection, row, tx)) {
        clearPendingBurn(row);
        message(`Original burn ${tx ? 'failed' : 'expired without landing'}: ${row.signature}. No replacement was sent.`);
      } else await reconcile(row);
    } catch {
      message(`Burn verification is still pending: ${row.signature}. Check burn status to retry the original receipt.`);
    } finally { busy = false; app.fundedBurnBusy = false; app.updateFundedBurnButton(); }
  }
  return { reconcile, check };
}
