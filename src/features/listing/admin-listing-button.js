import { apiRequest } from '../../../client.js';

// Admin wallets list an external token without the $RICH burn: the wallet signs
// a message naming the mint (no transaction, no fee) and the server checks the
// signature against its admin wallet list before recording the listing.
const message = ({ mint, wallet, issuedAt }) =>
  `richpad.fun admin listing\nList this token without a fee.\nMint: ${mint}\nWallet: ${wallet}\nIssued: ${issuedAt}`;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let value = 0n; for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = ''; while (value > 0n) { out = ALPHABET[Number(value % 58n)] + out; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out; }
  return out;
}

export function mountAdminListingButton({ anchor, getSession, connectWallet, onListed, setStatus }) {
  if (!anchor || document.getElementById('list-admin')) return () => {};
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'list-admin'; button.className = 'secondary-button list-admin-button';
  button.textContent = 'List for free (admin)';
  anchor.after(button);
  const status = new Map();
  let current = { mint: null, ready: false }, busy = false;
  const check = wallet => {
    if (!wallet || status.has(wallet)) return;
    status.set(wallet, null);
    apiRequest(`/api/listings/admin-status?wallet=${encodeURIComponent(wallet)}`, { signal: AbortSignal.timeout(8000) })
      .then(result => { status.set(wallet, result.data?.admin === true); update(current); })
      .catch(() => status.delete(wallet));
  };
  const update = next => {
    current = next;
    const wallet = getSession()?.address;
    check(wallet);
    const isAdmin = status.get(wallet) === true;
    // Show button but disable for non-admin wallets so users can see the feature exists
    button.hidden = !(next.ready && next.mint && !busy);
    button.disabled = busy || !isAdmin;
    button.textContent = busy ? 'Listing…' : isAdmin ? 'List for free (admin)' : 'List for free (admin only)';
    button.title = isAdmin ? '' : 'Only available when signed in with an admin wallet';
  };
  button.addEventListener('click', async () => {
    const mint = current.mint;
    if (!mint || busy) return;
    const isAdmin = status.get(getSession()?.address) === true;
    if (!isAdmin) return;
    busy = true; update(current);
    try {
      let session = getSession();
      if (!session) { await connectWallet(); session = getSession(); }
      if (!session?.provider?.signMessage) throw new Error('Connect a wallet that can sign messages.');
      const issuedAt = new Date().toISOString();
      const signed = await session.provider.signMessage(new TextEncoder().encode(message({ mint, wallet: session.address, issuedAt })), 'utf8');
      const signature = signed?.signature || signed;
      const result = await apiRequest('/api/listings/admin', { method: 'POST', signal: AbortSignal.timeout(20000),
        body: { mint, wallet: session.address, issuedAt, signature: base58(new Uint8Array(signature)) } });
      setStatus('Listed by admin. No fee was charged.');
      await onListed?.(result.data);
    } catch (error) {
      setStatus(`Admin listing failed: ${error?.message || 'unknown error'}. Nothing was charged.`);
    } finally { busy = false; update(current); }
  });
  return update;
}
