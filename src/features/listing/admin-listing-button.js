import { apiRequest } from '../../../client.js';

// "List for free (admin)" on the listing page. Admin status is decided only by
// the server from the admin JWT cookie set at wallet sign-in (GET /api/auth/admin);
// the button is shown just for that signed-in admin wallet, and the free listing
// request itself is re-checked on the server.
export function mountAdminListingButton({ anchor, getSession, onListed, setStatus }) {
  if (!anchor || document.getElementById('list-admin')) return () => {};
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'list-admin'; button.className = 'secondary-button list-admin-button';
  button.textContent = 'List for free (admin)';
  button.hidden = true;
  anchor.after(button);
  const status = { wallet: null, admin: false, checkedAt: 0, pending: null };
  let current = { mint: null, ready: false }, busy = false;
  const check = wallet => {
    if (!wallet || status.pending || (status.wallet === wallet && Date.now() - status.checkedAt < 30_000)) return;
    status.pending = apiRequest('/api/auth/admin', { signal: AbortSignal.timeout(8000) })
      .then(result => result.data?.admin === true && result.data.wallet === wallet)
      .catch(() => false)
      .then(admin => { Object.assign(status, { wallet, admin, checkedAt: Date.now(), pending: null }); update(current); });
  };
  const update = next => {
    current = next;
    const wallet = getSession()?.address;
    check(wallet);
    const isAdmin = Boolean(wallet) && status.wallet === wallet && status.admin;
    // Only a signed-in admin wallet sees the free listing option.
    button.hidden = !(next.ready && next.mint && isAdmin);
    button.disabled = busy;
    button.textContent = busy ? 'Listing…' : 'List for free (admin)';
  };
  // Signing in (or switching wallets) changes the server's answer; check again at once
  // instead of keeping a "not admin" result from before the signature.
  const recheck = () => { Object.assign(status, { wallet: null, admin: false, checkedAt: 0 }); update(current); };
  globalThis.addEventListener?.('funded:wallet-authenticated', recheck);
  globalThis.addEventListener?.('funded:reward-identity-change', recheck);
  button.addEventListener('click', async () => {
    const mint = current.mint;
    if (!mint || busy || !status.admin) return;
    if (!globalThis.confirm?.('List this token for free as admin? No payment and no wallet signature are needed.')) return;
    busy = true; update(current);
    try {
      const result = await apiRequest('/api/listings/admin', { method: 'POST', signal: AbortSignal.timeout(20000), body: { mint } });
      setStatus('Listed by admin. No fee was charged.');
      await onListed?.(result.data);
    } catch (error) {
      if (error?.status === 401) Object.assign(status, { admin: false, checkedAt: Date.now() });
      setStatus(`Admin listing failed: ${error?.message || 'unknown error'}. Nothing was charged.`);
    } finally { busy = false; update(current); }
  });
  return update;
}
