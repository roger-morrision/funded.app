import { apiRequest } from '../../../client.js';

// Admin wallets boost a token without paying: the wallet signs a message naming
// the mint and package (no transaction, no fee) and the server checks it against
// its admin wallet list before recording the boost.
const message = ({ mint, packageId, wallet, issuedAt }) =>
  `richpad.fun admin boost\nBoost this token without a fee.\nMint: ${mint}\nPackage: ${packageId}\nWallet: ${wallet}\nIssued: ${issuedAt}`;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let value = 0n; for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = ''; while (value > 0n) { out = ALPHABET[Number(value % 58n)] + out; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out; }
  return out;
}

const adminStatus = new Map();
let busy = false;

// Called after each boost dialog render: adds "Boost for free (admin)" under
// the pay button when the connected wallet is an administrator.
export function decorateAdminBoost(appState, details) {
  const wallet = appState.connectedWalletAddress;
  const pay = details?.querySelector('.explore-boost-pay');
  if (!pay || !wallet) return;
  if (!adminStatus.has(wallet)) {
    adminStatus.set(wallet, null);
    apiRequest(`/api/listings/admin-status?wallet=${encodeURIComponent(wallet)}`, { signal: AbortSignal.timeout(8000) })
      .then(result => { adminStatus.set(wallet, result.data?.admin === true); if (result.data?.admin === true) appState.renderExploreBoostDialog(); })
      .catch(() => adminStatus.delete(wallet));
    return;
  }
  if (adminStatus.get(wallet) !== true) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'secondary-button explore-boost-admin';
  button.textContent = busy ? 'Boosting…' : 'Boost for free (admin)';
  button.disabled = busy || Boolean(appState.boostCheckout.pendingSignature);
  pay.after(button);
  button.addEventListener('click', async () => {
    const { mint, packageId } = appState.boostCheckout;
    if (!mint || !packageId || busy) return;
    busy = true; appState.renderExploreBoostDialog();
    try {
      let session = appState.captureWalletSession?.();
      if (!session) { await appState.connectWallet(); session = appState.captureWalletSession?.(); }
      if (!session?.provider?.signMessage) throw new Error('Connect a wallet that can sign messages.');
      const issuedAt = new Date().toISOString();
      const signed = await session.provider.signMessage(new TextEncoder().encode(message({ mint, packageId, wallet: session.address, issuedAt })), 'utf8');
      const signature = signed?.signature || signed;
      await apiRequest('/api/boosts/admin', { method: 'POST', signal: AbortSignal.timeout(20000),
        body: { mint, packageId, wallet: session.address, issuedAt, signature: base58(new Uint8Array(signature)) } });
      appState.boostCheckout.message = 'Boosted by admin. No fee was charged.';
      await appState.loadExploreBoostHistory(mint);
      void appState.loadVerifiedBoosts?.();
    } catch (error) {
      appState.boostCheckout.message = `Admin boost failed: ${error?.message || 'unknown error'}. Nothing was charged.`;
    } finally { busy = false; appState.renderExploreBoostDialog(); }
  });
}
