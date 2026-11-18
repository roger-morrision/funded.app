import { apiRequest } from '../../../client.js';

// "Boost for free (admin)" in the boost dialog. Admin status is decided only by
// the server from the admin JWT cookie set at wallet sign-in (GET /api/auth/admin);
// the button is shown just for that signed-in admin wallet, and the free boost
// request itself is re-checked on the server.
const status = { wallet: null, admin: false, checkedAt: 0, pending: null };
let busy = false;
const FRESH_MS = 30_000;

function refreshAdmin(appState, wallet) {
  if (status.pending) return;
  status.pending = apiRequest('/api/auth/admin', { signal: AbortSignal.timeout(8000) })
    .then(result => result.data?.admin === true && result.data.wallet === wallet)
    .catch(() => false)
    .then(admin => {
      const changed = admin !== status.admin || status.wallet !== wallet;
      Object.assign(status, { wallet, admin, checkedAt: Date.now(), pending: null });
      if (changed) appState.renderExploreBoostDialog();
    });
}

// Signing in (or switching wallets) changes the server's answer; check again at once
// instead of keeping a "not admin" result from before the signature.
let lastAppState = null;
const recheck = () => {
  Object.assign(status, { wallet: null, admin: false, checkedAt: 0 });
  lastAppState?.renderExploreBoostDialog?.();
};
globalThis.addEventListener?.('funded:wallet-authenticated', recheck);
globalThis.addEventListener?.('funded:reward-identity-change', recheck);

export function decorateAdminBoost(appState, details) {
  lastAppState = appState;
  const session = appState.captureWalletSession?.();
  const live = session && (typeof appState.isWalletSessionCurrent === 'function' ? appState.isWalletSessionCurrent(session) : true);
  const wallet = live ? session.address : null;
  const pay = details?.querySelector('.explore-boost-pay');
  if (!pay || !wallet) return;
  if (status.wallet !== wallet || Date.now() - status.checkedAt > FRESH_MS) refreshAdmin(appState, wallet);
  if (!(status.admin && status.wallet === wallet)) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'secondary-button explore-boost-admin';
  button.textContent = busy ? 'Boosting…' : 'Boost for free (admin)';
  button.disabled = busy || Boolean(appState.boostCheckout.pendingSignature);
  pay.after(button);
  button.addEventListener('click', async () => {
    const { mint, packageId } = appState.boostCheckout;
    if (!mint || !packageId || busy) return;
    // Free boosts need no wallet signature, so confirm each one explicitly.
    if (!globalThis.confirm?.(`Add a free ${packageId} boost to this token? No payment and no wallet signature are needed; each confirmation adds one more boost.`)) return;
    busy = true; appState.renderExploreBoostDialog();
    try {
      await apiRequest('/api/boosts/admin', { method: 'POST', signal: AbortSignal.timeout(20000), body: { mint, packageId } });
      await appState.loadExploreBoostHistory(mint);
      const total = appState.activeBoostMultiplier?.(appState.verifiedBoosts?.[mint]);
      appState.boostCheckout.message = `Free ${packageId} boost added by admin${total ? ` · active now ${total}x` : ''}. No fee was charged.`;
      void appState.loadVerifiedBoosts?.();
    } catch (error) {
      if (error?.status === 401) Object.assign(status, { admin: false, checkedAt: Date.now() });
      appState.boostCheckout.message = `Admin boost failed: ${error?.message || 'unknown error'}. Nothing was charged.`;
    } finally { busy = false; appState.renderExploreBoostDialog(); }
  });
}
