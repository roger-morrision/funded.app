import { walletAddressMarkup } from './src/features/shared/wallet-links.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { createAdminSession, STALE_ADMIN_REQUEST } from './admin-session.js';
import { initAdminWithdrawals } from './admin-withdrawals.js';
import { createConfirmedAdminPost } from './admin-email-confirmation.js';
import { SOLANA_GENESIS } from './solana-network.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

const $ = selector => document.querySelector(selector);
const message = $('#message');
const wallet = () => window.phantom?.solana || window.solana || null;
const show = (value, error = false) => { if (String(value).startsWith(STALE_ADMIN_REQUEST)) return; message.textContent = value; message.classList.toggle('error', error); };
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const sol = lamports => (Number(lamports) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits:9 });

const session = createAdminSession({ document, onEnd:() => {
  overview = null; refreshGeneration++;
  $('#refresh').disabled = false;
  $('#wallet-rows').replaceChildren(); $('#ops-rows').replaceChildren();
  $('#withdraw-source').replaceChildren(); $('#withdraw-destination').value = '';
  show(''); withdrawals?.sync();
}});
const api = async (path, options = {}) => {
  const epoch = session.epoch;
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options,
    headers:{ ...(options.body ? { 'content-type':'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!session.current(epoch)) throw Error(STALE_ADMIN_REQUEST);
  if (response.status === 401 && session.active) session.end('Session expired. Sign in again.');
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status:response.status, code:data.code });
  return data;
};
const confirmedPost = createConfirmedAdminPost({ api, session });
const post = (path, body) => confirmedPost(path, body);

let connected = null, overview = null, authBusy = false, refreshGeneration = 0, opsGeneration = 0, withdrawals;
function authControls() { $('#sign-in').disabled = authBusy || !connected; $('#sign-out').disabled = authBusy; }
function updateWallet() {
  connected = wallet()?.publicKey?.toBase58() || null;
  $('#connected-address').textContent = connected || 'No wallet connected';
  authControls();
}
async function connect() {
  const provider = wallet();
  if (!provider?.connect || !provider?.signMessage) throw new Error('A Solana wallet with message signing is required.');
  await provider.connect(); updateWallet();
}
async function signIn() {
  if (authBusy) return; authBusy = true; const epoch = session.end(); authControls();
  try {
    if (!connected) await connect(); const address = connected, provider = wallet();
    const challenge = await post('/api/admin/challenge', { wallet:address });
    const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
    if (!session.current(epoch)) return;
    if (provider.publicKey?.toBase58() !== address) throw Error('The wallet changed during sign-in. Sign in again.');
    const result = await post('/api/admin/session', { wallet:address, nonce:challenge.nonce, signature:bs58.encode(signed.signature) });
    if (!session.activate(result, epoch)) return; authBusy = false; authControls();
    await refresh(); if (session.current(epoch) && session.active) show('Admin session active.');
  } finally { if (session.current(epoch)) { authBusy = false; authControls(); } }
}
async function restoreSession() {
  const epoch = session.epoch; let result;
  try { result = await api('/api/admin/session'); }
  catch (error) { if (session.current(epoch) && error.status !== 401) show('Session status unavailable. Sign in or retry.', true); return; }
  if (!session.activate(result, epoch)) return;
  try { await refresh(); } catch (error) { if (session.current(epoch)) show(error.message, true); }
}
async function signOut() {
  if (authBusy) return; authBusy = true; const epoch = session.end(); authControls();
  try { await post('/api/admin/logout', {}); if (session.current(epoch)) show('Signed out.'); }
  catch (error) { if (session.current(epoch)) {
    if (error.status === 401) show('Signed out.'); else { $('#sign-out').hidden = false; $('#auth-status').textContent = 'Sign-out unavailable; workspace locked'; show('Could not confirm sign-out. Retry signing out.', true); }
  } } finally { if (session.current(epoch)) { authBusy = false; authControls(); } }
}
function renderWallets() {
  const rows = overview?.wallets || [];
  const selectedSource = $('#withdraw-source').value;
  $('#wallet-rows').innerHTML = rows.length ? rows.map(row => `<tr><td>${escape(row.role)}</td><td><code>${walletAddressMarkup(row.address)}</code></td>
    <td>${escape(row.custody)}</td><td>${sol(row.lamports)}</td><td>${row.withdrawable && row.address !== overview.withdrawalDestination
      ? `<button type="button" data-source="${escape(row.address)}">Withdraw</button>`
      : row.withdrawable ? '<span>Signed-in admin wallet</span>'
        : '<span title="Source signer is not configured">No sweep</span>'}</td></tr>`).join('') : '<tr><td colspan="5">No fee wallet addresses configured.</td></tr>';
  $('#withdraw-source').innerHTML = rows.filter(row => row.withdrawable && row.address !== overview.withdrawalDestination)
    .map(row => `<option value="${escape(row.address)}" data-signing-mode="${escape(row.signingMode)}">${escape(row.role)} · ${escape(row.address.slice(0, 7))}…</option>`).join('');
  if ([...$('#withdraw-source').options].some(option => option.value === selectedSource)) $('#withdraw-source').value = selectedSource;
  $('#withdraw-destination').value = overview.withdrawalDestination || '';
  withdrawals?.sync();
  $('#wallet-rows').querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
    $('#withdraw-source').value = button.dataset.source; $('#withdraw-source').dispatchEvent(new Event('change'));
    $('#withdraw-amount').focus(); $('#withdraw-form').scrollIntoView({ behavior:'smooth', block:'center' });
  }));
}
async function refreshWallets() {
  const generation = ++refreshGeneration;
  $('#refresh').disabled = true;
  try { overview = await api('/api/admin/fee-wallets'); if (generation !== refreshGeneration) return; renderWallets(); show(''); }
  catch (error) { if (generation === refreshGeneration) show(error.message, true); }
  finally { if (generation === refreshGeneration) $('#refresh').disabled = false; }
}
function renderOpsRows(rows) {
  $('#ops-rows').innerHTML = rows.length ? rows.map(row => `<tr><td><code>${escape(row.mint)}</code></td><td><code>${escape(row.recipient)}</code></td>
    <td>${sol(row.amountLamports)}</td><td>${escape(row.status)}${row.expired ? ' (expired)' : ''}</td><td><code>${escape(row.requestedBy)}</code></td>
    <td>${row.status === 'pending' ? `<button type="button" data-ops-approve="${escape(row.id)}">Approve</button><button type="button" data-ops-cancel="${escape(row.id)}">Cancel</button>`
      : row.status === 'approved' ? `<button type="button" data-ops-cancel="${escape(row.id)}">Cancel</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="6">No operations-payout requests.</td></tr>';
  $('#ops-rows').querySelectorAll('[data-ops-approve]').forEach(button => button.addEventListener('click', () => runOps(() => post('/api/admin/operations-payouts/approve', { requestId:button.dataset.opsApprove }))));
  $('#ops-rows').querySelectorAll('[data-ops-cancel]').forEach(button => button.addEventListener('click', () => runOps(() => post('/api/admin/operations-payouts/cancel', { requestId:button.dataset.opsCancel }))));
}
async function refreshOps() {
  const generation = ++opsGeneration;
  try { const { requests } = await api('/api/admin/operations-payouts/requests'); if (generation === opsGeneration) renderOpsRows(requests); }
  catch (error) { if (generation === opsGeneration) $('#ops-status').textContent = error.message; }
}
async function runOps(action) {
  $('#ops-status').textContent = 'Working…';
  try { await action(); $('#ops-status').textContent = 'Done.'; await refreshOps(); }
  catch (error) { $('#ops-status').textContent = error.message; }
}
async function refresh() { await Promise.all([refreshWallets(), refreshOps()]); }

$('#connect').addEventListener('click', () => void connect().catch(error => show(error.message, true)));
$('#sign-in').addEventListener('click', () => void signIn());
$('#sign-out').addEventListener('click', () => void signOut());
$('#refresh').addEventListener('click', () => void refreshWallets());
$('#ops-refresh').addEventListener('click', () => void refreshOps());
$('#ops-request-form').addEventListener('submit', event => {
  event.preventDefault();
  void runOps(() => post('/api/admin/operations-payouts/request', {
    mint:$('#ops-mint').value.trim(), quoteMint:$('#ops-quote-mint').value.trim() || undefined,
    recipient:$('#ops-recipient').value.trim(), amountLamports:Number($('#ops-amount').value) }));
});
window.phantom?.solana?.on?.('connect', updateWallet);
window.phantom?.solana?.on?.('disconnect', updateWallet);
window.phantom?.solana?.on?.('accountChanged', updateWallet);
updateWallet();
const cluster = import.meta.env.VITE_SOLANA_CLUSTER || 'devnet';
withdrawals = initAdminWithdrawals({ api, post, show, refresh:refreshWallets, wallet, connected:() => connected,
  expectedGenesis:SOLANA_GENESIS[cluster] });
void restoreSession();
