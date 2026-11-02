import { Buffer } from 'buffer';
import {refreshFinancialHealth} from './admin-financial-health.js';
import {initAdminRpcHealth} from './admin-rpc-health.js';
import { initAdminDailyBonus } from './admin-daily-bonus.js';
import { initAdminServiceFees } from './admin-service-fees.js';
import {initAdminResiduals} from './admin-residuals.js';
import {initAdminAgencyPolicy} from './admin-agency-policy.js';
import {initAdminXPosts} from './admin-x-posts.js';
import {initAdminProductIssues} from './admin-product-issues.js';
import bs58 from 'bs58';
import {createAdminSession,STALE_ADMIN_REQUEST} from './admin-session.js';
import {initAdminWithdrawals} from './admin-withdrawals.js';
import { validateProtocolFeeSplit } from './distribution-policy.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

const $ = selector => document.querySelector(selector);
const message = $('#message');
const wallet = () => window.phantom?.solana || window.solana || null;
const show = (value, error = false) => { if(String(value).startsWith(STALE_ADMIN_REQUEST))return; message.textContent = value; message.classList.toggle('error', error); };
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const api = async (path, options = {}) => {
  const epoch=session.epoch;
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store',
    ...options, headers:{ ...(options.body ? { 'content-type':'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if(!session.current(epoch))throw Error(STALE_ADMIN_REQUEST);
  if(response.status===401&&session.active)session.end('Session expired. Sign in again.');
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`),{status:response.status});
  return data;
};
const post = (path, body) => api(path, { method:'POST', body:JSON.stringify(body) });
const sol = lamports => (Number(lamports) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits:9 });
let connected = null, overview = null, policy = null, nextVault = 0, vaultLoading = false;
let authBusy=false,feeSaving=false,refreshGeneration=0,auditGeneration=0,vaultGeneration=0,withdrawals;
const session=createAdminSession({document,onEnd:()=>{
 overview=policy=null;feeSaving=false;refreshGeneration++;auditGeneration++;vaultGeneration++;nextVault=0;vaultLoading=false;
 $('#refresh').disabled=false;
 for(const id of ['summary','wallet-rows','audit','vaults','gates'])document.getElementById(id).replaceChildren();
 $('#withdraw-source').replaceChildren();$('#withdraw-destination').replaceChildren();
 $('#financial-health').textContent='Sign in to load monitoring.';show('');withdrawals?.sync();
}});
function authControls(){ $('#sign-in').disabled=authBusy||!connected;$('#sign-out').disabled=authBusy; }


function updateWallet() {
  connected = wallet()?.publicKey?.toBase58() || null;
  $('#connected-address').textContent = connected || 'No wallet connected';
  authControls();
  if (overview) renderWallets();
}
async function connect() {
  const provider = wallet();
  if (!provider?.connect || !provider?.signMessage) throw new Error('A Solana wallet with message signing is required.');
  await provider.connect(); updateWallet();
}
async function signIn() {
 if(authBusy)return;authBusy=true;const epoch=session.end();authControls();
 try{
  if(!connected)await connect();const address=connected,provider=wallet();
  const challenge=await post('/api/admin/challenge',{wallet:address});
  const signed=await provider.signMessage(new TextEncoder().encode(challenge.message),'utf8');
  if(!session.current(epoch))return;
  if(provider.publicKey?.toBase58()!==address)throw Error('The wallet changed during sign-in. Sign in again.');
  const result=await post('/api/admin/session',{wallet:address,nonce:challenge.nonce,signature:bs58.encode(signed.signature)});
  if(!session.activate(result,epoch))return;authBusy=false;authControls();
  await refresh();if(session.current(epoch)&&session.active)show('Admin session active.');
 }finally{if(session.current(epoch)){authBusy=false;authControls();}}
}
async function restoreSession() {
 const epoch=session.epoch;let result;
 try{result=await api('/api/admin/session');}
 catch(error){if(session.current(epoch)&&error.status!==401)show('Session status unavailable. Sign in or retry.',true);return;}
 if(!session.activate(result,epoch))return;
 try{await refresh();}catch(error){if(session.current(epoch))show(error.message,true);}
}
async function signOut(){
 if(authBusy)return;authBusy=true;const epoch=session.end();authControls();
 try{await post('/api/admin/logout',{});if(session.current(epoch))show('Signed out.');}
 catch(error){if(session.current(epoch)){
  if(error.status===401)show('Signed out.');else{$('#sign-out').hidden=false;$('#auth-status').textContent='Sign-out unavailable; workspace locked';show('Could not confirm sign-out. Retry signing out.',true);}
 }}finally{if(session.current(epoch)){authBusy=false;authControls();}}
}
function renderSummary() {
  const revenue = overview.revenue;
  const unique = new Map(overview.wallets.map(row => [row.address, BigInt(row.lamports)]));
  const total = [...unique.values()].reduce((sum, value) => sum + value, 0n);
  $('#summary').innerHTML = `<div><span>Listed app wallet SOL</span><strong>${sol(total)} SOL</strong><small>Finalized Devnet balance · ${unique.size} distinct addresses</small></div>
    <div><span>Verified V3 collections</span><strong>${sol(revenue.verifiedCollectionsLamports)} SOL</strong><small>Recorded gross fees, not profit or withdrawable cash</small></div>
    <div><span>Operations &amp; marketing allocation</span><strong>${sol(revenue.operationsAllocationLamports)} SOL</strong><small>${revenue.finalizedSettlementCount} finalized settlements · before payouts</small></div>`;
}
function renderWallets() {
  const rows = overview?.wallets || [];
  $('#wallet-rows').innerHTML = rows.length ? rows.map(row => `<tr><td>${escape(row.role)}</td><td><code>${escape(row.address)}</code></td>
    <td>${escape(row.custody)}</td><td>${sol(row.lamports)}</td><td>${row.withdrawable && row.address === connected
      ? `<button type="button" data-source="${escape(row.address)}">Withdraw</button>`
      : row.withdrawable ? '<span title="Connect this source wallet in Phantom to sign">Source signature required</span>'
        : '<span title="Operational signer; use its dedicated payout workflow">Operational signer · no sweep</span>'}</td></tr>`).join('') : '<tr><td colspan="5">No app wallet addresses configured.</td></tr>';
  $('#withdraw-source').innerHTML = rows.filter(row => row.withdrawable && row.custody === 'external wallet')
    .map(row => `<option value="${escape(row.address)}">${escape(row.role)} · ${escape(row.address.slice(0, 7))}…</option>`).join('');
  withdrawals?.sync();
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
  for(const control of form.querySelectorAll('input,button'))control.disabled=feeSaving||split.agencyPercent!==undefined;
  for (const field of ['operationsPercent', 'communityPercent', 'buybackPercent']) form.elements[field].value = split[field];
  split.referralLevelPercents.forEach((value, index) => { form.elements[`referral${index + 1}`].value = value; });
  $('#policy-revision').textContent = `Revision ${policy.revision}${policy.updatedAt ? ` · ${new Date(policy.updatedAt).toLocaleString()}` : ' · build default'}`;
  feeTotal();
}
function readSplit() {
  const form = $('#fee-form');
  return { operationsPercent:Number(form.elements.operationsPercent.value),
    referralLevelPercents:[1, 2, 3].map(i => Number(form.elements[`referral${i}`].value)),
    communityPercent:Number(form.elements.communityPercent.value), buybackPercent:Number(form.elements.buybackPercent.value),
    ...(policy?.split?.agencyPercent===undefined?{}:{agencyPercent:policy.split.agencyPercent}) };
}
function feeTotal() {
  const split = readSplit(), rates = [split.operationsPercent, ...split.referralLevelPercents, split.communityPercent, split.buybackPercent,...(split.agencyPercent===undefined?[]:[split.agencyPercent])];
  const total = rates.reduce((sum, value) => sum + value, 0);
  const gross = value => `${Number((value / 5).toFixed(6))}%`;
  $('#fee-gross-preview').textContent = `Gross collected fees: 80% creator-directed · ${gross(split.operationsPercent)} Operations & marketing · ${gross(split.referralLevelPercents.reduce((sum, rate) => sum + rate, 0))} referrals · ${gross(split.communityPercent)} Daily bonus · ${gross(split.buybackPercent)} buyback. Existing coins retain their saved policy.`;
  if(split.agencyPercent!==undefined)$('#fee-gross-preview').textContent+=` AI agency: ${gross(split.agencyPercent)} of gross. Use the authority-signed configuration publication below for updates.`;
  const target = $('#fee-total');
  target.textContent = `Allocation-weight total: ${total.toFixed(4)}% / 100%`;
  target.classList.toggle('invalid', Math.abs(total - 100) > 0.000001);
}
async function refresh() {
 if(!session.active||feeSaving)return;
 const epoch=session.epoch,request=++refreshGeneration;$('#refresh').disabled=true;
 try{
  const [feeResult,walletResult]=await Promise.allSettled([api('/api/fee-policy'),api('/api/admin/overview')]);
  if(!session.current(epoch)||!session.active||request!==refreshGeneration)return;
  const errors=[];
  if(feeResult.status==='fulfilled'){policy=feeResult.value;renderPolicy();}
  else{policy=null;$('#policy-revision').textContent='Fee policy unavailable. Refresh to retry.';$('#fee-form').querySelectorAll('input,button').forEach(n=>n.disabled=true);errors.push('Fee policy unavailable');}
  if(walletResult.status==='fulfilled'){overview=walletResult.value;renderSummary();renderWallets();renderGates();}
  else{overview=null;$('#summary').textContent='Finalized balances unavailable. Refresh to retry.';$('#wallet-rows').replaceChildren();$('#gates').textContent='Operational settings unavailable.';$('#withdraw-source').replaceChildren();withdrawals?.sync();errors.push('Wallet balances unavailable');}
  vaultGeneration++;vaultLoading=false;nextVault=0;$('#vaults').replaceChildren();$('#more-vaults').disabled=false;$('#more-vaults').textContent='Load vaults';
  await Promise.allSettled([refreshAudit(),dailyBonusRecovery.refresh(),refreshFinancialHealth({api}),rpcHealth.refresh()]);
  if(errors.length&&session.current(epoch))throw Error(errors.join('. ')+'. Your admin session is still active.');
 }finally{if(request===refreshGeneration)$('#refresh').disabled=false;}
}
async function refreshAudit() {
 if(!session.active)return;
 const epoch=session.epoch,request=++auditGeneration;
 try{
  const result=await api('/api/admin/audit');
  if(!session.current(epoch)||!session.active||request!==auditGeneration)return;
  $('#audit').innerHTML=result.entries.length?result.entries.map(entry=>`<p><strong>${escape(entry.action)}</strong> · ${escape(entry.at)} · ${escape(entry.wallet)}${entry.signature?` · <code>${escape(entry.signature)}</code>`:''}</p>`).join(''):'<p>No admin actions recorded yet.</p>';
 }catch(error){
  if(session.current(epoch)&&session.active&&request===auditGeneration)$('#audit').textContent='Audit history unavailable. Refresh to retry.';
  throw error;
 }
}
async function loadVaults() {
  if (!session.active || nextVault == null || vaultLoading) return;
  const epoch=session.epoch,request=++vaultGeneration;
  vaultLoading = true;
  $('#more-vaults').disabled = true;
  $('#more-vaults').textContent = 'Loading vaults…';
  try {
    const page = await api(`/api/admin/vaults?offset=${nextVault}`);
    if(!session.current(epoch)||!session.active||request!==vaultGeneration)return;
    $('#vaults').insertAdjacentHTML('beforeend', page.vaults.map(row => `<div class="vault-card"><h3>${escape(row.symbol || 'Mint')} · <code>${escape(row.mint)}</code></h3><p>Policy: ${escape(row.policyStatus)}</p><div class="vault-grid">${row.categories.map(category => `<div><strong>${escape(category.category)}</strong><br>Balance ${sol(category.lamports)} SOL · Payable ${category.payableLamports == null ? 'unavailable' : `${sol(category.payableLamports)} SOL`}${category.rentReserveLamports == null ? '' : ` · Rent reserve ${sol(category.rentReserveLamports)} SOL`}${category.shortfallLamports && category.shortfallLamports !== '0' ? ` · <em class="invalid">Shortfall ${sol(category.shortfallLamports)} SOL</em>` : ''}${category.unassignedLamports == null ? '' : ` · Unassigned ${sol(category.unassignedLamports)} SOL`}<br><small>${escape(category.accountingStatus)}</small> · <code>${escape(category.address)}</code></div>`).join('')}</div></div>`).join(''));
    if (!page.totalLaunches) $('#vaults').textContent = 'No V3 launches recorded.';
    nextVault = page.nextOffset;
  } finally {
    if(request!==vaultGeneration||!session.current(epoch))return;
    vaultLoading = false;
    $('#more-vaults').disabled = nextVault == null;
    $('#more-vaults').textContent = nextVault == null ? 'All vaults loaded' : nextVault === 0 ? 'Load vaults' : 'Load more vaults';
  }
}
$('#connect').addEventListener('click', () => connect().catch(error => show(error.message, true)));
$('#sign-in').addEventListener('click', () => signIn().catch(error => show(error.message, true)));
$('#sign-out').addEventListener('click',()=>{void signOut();});
$('#refresh').addEventListener('click', () => {const epoch=session.epoch;refresh().then(() => {if(session.current(epoch)&&session.active)show('Finalized balances refreshed.');}).catch(error => show(error.message, true));});
$('#refresh-audit').addEventListener('click', () => refreshAudit().catch(error => show(error.message, true)));
$('#more-vaults').addEventListener('click', () => loadVaults().catch(error => show(error.message, true)));
$('#fee-form').addEventListener('input', feeTotal);
$('#fee-form').addEventListener('submit', event => { event.preventDefault(); (async () => {
  if(!session.active||!policy||feeSaving)return;
  const split = validateProtocolFeeSplit(readSplit());
  if (!confirm(`Publish this split for future V3 launches?\nOperations & marketing ${Number((split.operationsPercent/5).toFixed(6))}% · referrals ${split.referralLevelPercents.map(rate=>Number((rate/5).toFixed(6))).join('/')}% · Daily bonus ${Number((split.communityPercent/5).toFixed(6))}% · $FUNDED buyback ${Number((split.buybackPercent/5).toFixed(6))}% (percentages of collected creator fees)\nExisting mint policies remain unchanged.`)) return;
  const epoch=session.epoch;feeSaving=true;refreshGeneration++;renderPolicy();
  let updated;try{updated=await post('/api/admin/fee-policy',{split,expectedRevision:policy.revision});}finally{if(session.current(epoch)){feeSaving=false;$('#refresh').disabled=false;if(policy&&session.active)renderPolicy();}}
  if(!session.current(epoch)||!session.active)return;
  policy = updated; renderPolicy(); show(`Fee policy revision ${updated.revision} published for future launches.`);
  await refreshAudit();
})().catch(error => show(error.message, true)); });
const provider = wallet();
const dailyBonusRecovery = initAdminDailyBonus({document,api,post,show,refreshAudit});
const rpcHealth=initAdminRpcHealth({api});
initAdminServiceFees({api,post,show});
const residuals=initAdminResiduals({api,post,show,wallet});
new MutationObserver(()=>{if($('#workspace').hidden)residuals.clear();}).observe($('#workspace'),{attributes:true,attributeFilter:['hidden']});
initAdminAgencyPolicy({api,post,show,refresh});
initAdminXPosts({api,post,show});
initAdminProductIssues({api,post,show});
withdrawals=initAdminWithdrawals({api,post,show,refresh,wallet,connected:()=>connected});
provider?.on?.('accountChanged', updateWallet);
provider?.on?.('disconnect', updateWallet);
updateWallet();
restoreSession();
