import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { validateProtocolFeeSplit } from './distribution-policy.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

const $ = selector => document.querySelector(selector);
const message = $('#message');
const wallet = () => window.phantom?.solana || window.solana || null;
const show = (value, error = false) => { message.textContent = value; message.classList.toggle('error', error); };
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store',
    ...options, headers:{ ...(options.body ? { 'content-type':'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
};
const post = (path, body) => api(path, { method:'POST', body:JSON.stringify(body) });
const sol = lamports => (Number(lamports) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits:9 });
let connected = null, overview = null, policy = null, nextVault = 0;

function updateWallet() {
  connected = wallet()?.publicKey?.toBase58() || null;
  $('#connected-address').textContent = connected || 'No wallet connected';
  $('#sign-in').disabled = !connected;
  if (overview) renderWallets();
}
async function connect() {
  const provider = wallet();
  if (!provider?.connect || !provider?.signMessage) throw new Error('A Solana wallet with message signing is required.');
  await provider.connect(); updateWallet();
}
async function signIn() {
  if (!connected) await connect();
  const challenge = await post('/api/admin/challenge', { wallet:connected });
  const signed = await wallet().signMessage(new TextEncoder().encode(challenge.message), 'utf8');
  const signature = bs58.encode(signed.signature);
  const result = await post('/api/admin/session', { wallet:connected, nonce:challenge.nonce, signature });
  $('#auth-status').textContent = `Signed in: ${result.wallet.slice(0, 5)}…${result.wallet.slice(-5)}`;
  $('#sign-out').hidden = false;
  $('#workspace').hidden = false;
  await refresh();
  show('Admin session active.');
}
async function restoreSession() {
  try {
    const session = await api('/api/admin/session');
    $('#auth-status').textContent = `Signed in: ${session.wallet.slice(0, 5)}…${session.wallet.slice(-5)}`;
    $('#sign-out').hidden = false;
    $('#workspace').hidden = false;
    await refresh();
  } catch { $('#workspace').hidden = true; }
}
function renderSummary() {
  const revenue = overview.revenue;
  const unique = new Map(overview.wallets.map(row => [row.address, BigInt(row.lamports)]));
  const total = [...unique.values()].reduce((sum, value) => sum + value, 0n);
  $('#summary').innerHTML = `<div><span>Listed app wallet SOL</span><strong>${sol(total)} SOL</strong><small>Finalized Devnet balance · ${unique.size} distinct addresses</small></div>
    <div><span>Verified V3 collections</span><strong>${sol(revenue.verifiedCollectionsLamports)} SOL</strong><small>Recorded gross fees, not profit or withdrawable cash</small></div>
    <div><span>Operations allocation</span><strong>${sol(revenue.operationsAllocationLamports)} SOL</strong><small>${revenue.finalizedSettlementCount} finalized settlements · before payouts</small></div>`;
}
function renderWallets() {
  const rows = overview?.wallets || [];
  $('#wallet-rows').innerHTML = rows.length ? rows.map(row => `<tr><td>${escape(row.role)}</td><td><code>${escape(row.address)}</code></td>
    <td>${escape(row.custody)}</td><td>${sol(row.lamports)}</td><td>${row.address === connected
      ? `<button type="button" data-source="${escape(row.address)}">Withdraw</button>`
      : '<span title="Connect this source wallet in Phantom to sign">Source signature required</span>'}</td></tr>`).join('') : '<tr><td colspan="5">No app wallet addresses configured.</td></tr>';
  $('#withdraw-source').innerHTML = rows.map(row => `<option value="${escape(row.address)}">${escape(row.role)} · ${escape(row.address.slice(0, 7))}…</option>`).join('');
  $('#withdraw-destination').innerHTML = (overview.withdrawalDestinations || []).map(address => `<option value="${escape(address)}">${escape(address)}</option>`).join('');
  $('#wallet-rows').querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
    $('#withdraw-source').value = button.dataset.source;
    $('#withdraw-amount').focus();
    $('#withdraw-form').scrollIntoView({ behavior:'smooth', block:'center' });
  }));
}
function renderGates() {
  $('#gates').innerHTML = Object.entries(overview.gates).map(([label, enabled]) =>
    `<div><span>${escape(label.replaceAll(/([A-Z])/g, ' $1'))}</span><strong class="${enabled ? 'good' : 'off'}">${enabled ? 'Enabled' : 'Off'}</strong></div>`).join('');
}
function renderPolicy() {
  const split = policy.split, form = $('#fee-form');
  for (const field of ['operationsPercent', 'communityPercent', 'buybackPercent']) form.elements[field].value = split[field];
  split.referralLevelPercents.forEach((value, index) => { form.elements[`referral${index + 1}`].value = value; });
  $('#policy-revision').textContent = `Revision ${policy.revision}${policy.updatedAt ? ` · ${new Date(policy.updatedAt).toLocaleString()}` : ' · build default'}`;
  feeTotal();
}
function readSplit() {
  const form = $('#fee-form');
  return { operationsPercent:Number(form.elements.operationsPercent.value),
    referralLevelPercents:[1, 2, 3].map(i => Number(form.elements[`referral${i}`].value)),
    communityPercent:Number(form.elements.communityPercent.value), buybackPercent:Number(form.elements.buybackPercent.value) };
}
function feeTotal() {
  const split = readSplit(), rates = [split.operationsPercent, ...split.referralLevelPercents, split.communityPercent, split.buybackPercent];
  const total = rates.reduce((sum, value) => sum + value, 0);
  const target = $('#fee-total');
  target.textContent = `Protocol share total: ${total.toFixed(4)}% / 100%`;
  target.classList.toggle('invalid', Math.abs(total - 100) > 0.000001);
}
async function refresh() {
  [policy, overview] = await Promise.all([api('/api/fee-policy'), api('/api/admin/overview')]);
  renderPolicy(); renderSummary(); renderWallets(); renderGates();
  await refreshAudit();
}
async function refreshAudit() {
  const result = await api('/api/admin/audit');
  $('#audit').innerHTML = result.entries.length ? result.entries.map(entry => `<p><strong>${escape(entry.action)}</strong> · ${escape(entry.at)} · ${escape(entry.wallet)}${entry.signature ? ` · <code>${escape(entry.signature)}</code>` : ''}</p>`).join('') : '<p>No admin actions recorded yet.</p>';
}
async function loadVaults() {
  if (nextVault == null) return;
  const page = await api(`/api/admin/vaults?offset=${nextVault}`);
  $('#vaults').insertAdjacentHTML('beforeend', page.vaults.map(row => `<div class="vault-card"><h3>${escape(row.symbol || 'Mint')} · <code>${escape(row.mint)}</code></h3><div class="vault-grid">${row.categories.map(category => `<div><strong>${escape(category.category)}:</strong> ${sol(category.lamports)} SOL · <code>${escape(category.address)}</code></div>`).join('')}</div></div>`).join(''));
  if (!page.totalLaunches) $('#vaults').textContent = 'No V3 launches recorded.';
  nextVault = page.nextOffset;
  $('#more-vaults').disabled = nextVault == null;
  $('#more-vaults').textContent = nextVault == null ? 'All vaults loaded' : 'Load more vaults';
}
async function withdraw(event) {
  event.preventDefault();
  const source = $('#withdraw-source').value, destination = $('#withdraw-destination').value;
  const amountSol = Number($('#withdraw-amount').value);
  if (!connected || connected !== source) throw new Error('Connect the selected source wallet before signing its transfer.');
  if (!Number.isFinite(amountSol) || amountSol < .001 || amountSol > 5) throw new Error('Enter 0.001–5 SOL.');
  const amountLamports = Math.round(amountSol * 1_000_000_000);
  const plan = await post('/api/admin/withdrawals/prepare', { source, destination, amountLamports });
  const summary = `Withdraw ${sol(plan.amountLamports)} Devnet SOL\nFrom ${source}\nTo ${destination}\nThe source wallet will pay the network fee.`;
  $('#withdraw-review').textContent = summary.replaceAll('\n', ' · ');
  if (!confirm(`${summary}\n\nContinue to your wallet?`)) return;
  const rpc = new Connection(`${location.origin}/api/solana/rpc`, 'finalized');
  const genesis = await rpc.getGenesisHash();
  if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('The browser RPC is not Devnet.');
  const tx = new Transaction({ feePayer:new PublicKey(source), recentBlockhash:plan.blockhash })
    .add(SystemProgram.transfer({ fromPubkey:new PublicKey(source), toPubkey:new PublicKey(destination), lamports:plan.amountLamports }));
  const provider = wallet();
  if (!provider?.signTransaction) throw new Error('The source wallet must support transaction signing.');
  const signed = await provider.signTransaction(tx);
  const signature = await rpc.sendRawTransaction(signed.serialize(), { skipPreflight:false });
  $('#reconcile-signature').value = signature;
  show(`Submitted ${signature}. Waiting for finalized Devnet confirmation.`);
  const deadline = Math.min(Date.now() + 90_000, Date.parse(plan.expiresAt) - 5_000);
  let finalized = false;
  while (Date.now() < deadline) {
    const status = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory:true })).value[0];
    if (status?.err) throw new Error(`Devnet rejected ${signature}.`);
    if (status?.confirmationStatus === 'finalized') { finalized = true; break; }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  if (!finalized) throw new Error(`Confirmation timed out. Check ${signature} and record its finalized receipt below.`);
  const receipt = await post('/api/admin/withdrawals/verify', { id:plan.id, signature });
  show(`Finalized ${sol(receipt.amountLamports)} SOL withdrawal: ${receipt.signature}`);
  $('#withdraw-review').textContent = `Finalized receipt ${receipt.signature}`;
  await refresh();
}

$('#connect').addEventListener('click', () => connect().catch(error => show(error.message, true)));
$('#sign-in').addEventListener('click', () => signIn().catch(error => show(error.message, true)));
$('#sign-out').addEventListener('click', () => post('/api/admin/logout', {}).then(() => {
  $('#workspace').hidden = true; $('#sign-out').hidden = true; $('#auth-status').textContent = 'Not signed in'; show('Signed out.');
}).catch(error => show(error.message, true)));
$('#refresh').addEventListener('click', () => refresh().then(() => show('Finalized balances refreshed.')).catch(error => show(error.message, true)));
$('#refresh-audit').addEventListener('click', () => refreshAudit().catch(error => show(error.message, true)));
$('#more-vaults').addEventListener('click', () => loadVaults().catch(error => show(error.message, true)));
$('#fee-form').addEventListener('input', feeTotal);
$('#fee-form').addEventListener('submit', event => { event.preventDefault(); (async () => {
  const split = validateProtocolFeeSplit(readSplit());
  if (!confirm(`Publish this split for future V3 launches?\nOperations ${split.operationsPercent}% · referrals ${split.referralLevelPercents.join('/')}% · community ${split.communityPercent}% · buyback ${split.buybackPercent}%\nExisting mint policies remain unchanged.`)) return;
  const updated = await post('/api/admin/fee-policy', { split, expectedRevision:policy.revision });
  policy = updated; renderPolicy(); show(`Fee policy revision ${updated.revision} published for future launches.`);
  await refreshAudit();
})().catch(error => show(error.message, true)); });
$('#withdraw-form').addEventListener('submit', event => { withdraw(event).catch(error => show(error.message, true)); });
$('#reconcile-form').addEventListener('submit', event => { event.preventDefault(); (async () => {
  const signature = $('#reconcile-signature').value.trim();
  const receipt = await post('/api/admin/withdrawals/reconcile', { signature });
  show(`Finalized ${sol(receipt.amountLamports)} SOL transfer recorded: ${receipt.signature}`);
  await refreshAudit();
})().catch(error => show(error.message, true)); });
const provider = wallet();
provider?.on?.('accountChanged', updateWallet);
updateWallet();
restoreSession();
