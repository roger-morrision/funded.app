import { apiRequest } from './client.js';
import { readLaunchJournal, recordLaunchEvent, journalRecovery } from './launch-journal.js';
import { notificationItems } from './notification-model.js';
import { createFollowingFeed } from './following-feed.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storeGet=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const following=()=>{const list=storeGet('funded.creator.following',[]);return Array.isArray(list)?list.filter(id=>/^\d{1,24}$/.test(id)).slice(0,200):[];};
let notificationCreators=[];
function renderNotifications(){
  const dialog=$('#notification-dialog');if(!dialog)return;
  const read=storeGet('funded.notifications.read',[]),readIds=new Set(Array.isArray(read)?read:[]);
  const followed=new Set(following());
  const rows=notificationItems(readLaunchJournal(),storeGet('funded.updates.enabled',false)===true?notificationCreators.filter(creator=>followed.has(creator?.id)):[]);
  const unread=rows.filter(row=>!readIds.has(row.id)).length;
  dialog.querySelector('h2').textContent=unread?`${unread} unread app updates`:'App updates';
  dialog.querySelector('.notice-list').innerHTML=`<p>Local launch reminders and opted-in followed updates only. No push/email, complete wallet feed or new payout verification is implied.</p>${rows.map(row=>`<article><small>${esc(row.kind)}${readIds.has(row.id)?' · read':''}</small><h3>${esc(row.title)}</h3><p>${esc(row.text)}</p><a href="${esc(row.href)}">Review</a>${readIds.has(row.id)?'':`<button type="button" data-notice-read="${esc(row.id)}">Mark read</button>`}</article>`).join('')||'<p>No reminders or followed updates loaded. Manage updates in Portfolio.</p>'}<p id="notification-save-status" role="status"></p>`;
  dialog.querySelectorAll('a').forEach(link=>link.onclick=()=>dialog.close());
  dialog.querySelectorAll('[data-notice-read]').forEach(button=>button.onclick=()=>{try{localStorage.setItem('funded.notifications.read',JSON.stringify([...new Set([...readIds,button.dataset.noticeRead])].slice(-200)));renderNotifications();}catch{$('#notification-save-status').textContent='Read status could not be saved on this device.';}});
  $('#notifications-button')?.setAttribute('aria-label',unread?`Notifications, ${unread} unread`:'Notifications');
}
$('#notifications-button')?.addEventListener('click',renderNotifications);
window.addEventListener('funded:journal',renderNotifications);renderNotifications();

const imageTools=document.createElement('div');imageTools.className='adoption-tools image-picker-actions';
imageTools.innerHTML='<button type="button" id="image-upload" aria-label="Upload token image" title="Upload image"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5"/></svg></button><button type="button" id="image-remove" aria-label="Delete token image" title="Delete image" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button><p id="image-preparation-status" class="sr-only" role="status" aria-live="polite">No image selected.</p>';
const imageInput=$('#token-image');$('#token-image-picker')?.append(imageTools);
$('#image-upload').onclick=event=>{event.preventDefault();event.stopPropagation();imageInput.click();};
$('#image-remove').onclick=event=>{event.preventDefault();event.stopPropagation();imageInput.value='';imageInput.dispatchEvent(new Event('change',{bubbles:true}));};

const recovery=document.createElement('section');recovery.className='adoption-panel';recovery.id='launch-recovery';$('#my-launches').prepend(recovery);
function renderRecovery(){
  const rows=readLaunchJournal().slice().reverse();
  recovery.innerHTML=`<h2>Launch recovery</h2><p>Saved on this device. No private keys or signed transaction bytes are stored. Clearing browser storage removes this history.</p><p id="recovery-status" role="status"></p>${rows.map(row=>`<article><h3>${esc(row.name||'Launch')} · ${esc(row.state)}</h3><p>${esc(journalRecovery(row))}</p><small>${esc(row.mint||'Mint not prepared')} · ${esc(row.cluster)}</small><div class="support-actions">${row.signature?`<a href="https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}?cluster=devnet" target="_blank" rel="noopener noreferrer">Inspect last receipt</a><button data-recheck="${esc(row.id)}">Check transaction status</button>`:''}${row.state==='registration-pending'?`<button data-register="${esc(row.id)}">Finish policy registration</button>`:''}</div><details><summary>Step history</summary>${(row.events||[]).map(event=>`<p>${esc(event.at)} · ${esc(event.step||'launch')} · ${esc(event.state)}${event.signature?` · <a href="https://explorer.solana.com/tx/${encodeURIComponent(event.signature)}?cluster=devnet" target="_blank" rel="noopener noreferrer">Receipt</a>`:''}</p>`).join('')}</details></article>`).join('')||'<p>No launch attempts recorded on this device.</p>'}`;
  recovery.querySelectorAll('[data-recheck]').forEach(button=>button.onclick=async()=>{
    const row=readLaunchJournal().find(r=>r.id===button.dataset.recheck);if(!row?.signature||row.cluster!=='devnet')return;button.disabled=true;
    try{const response=await apiRequest('/api/solana/rpc',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'getSignatureStatuses',params:[[row.signature],{searchTransactionHistory:true}]},signal:AbortSignal.timeout(15000)});const receipt=response.data?.result?.value?.[0];if(!response.available||response.data?.error)throw new Error('Transaction verification unavailable. No retry was sent.');
      if(receipt?.err){recordLaunchEvent(row.id,{state:'failed',message:JSON.stringify(receipt.err)});$('#recovery-status').textContent='Recorded transaction failed on-chain. Earlier steps may still have succeeded.';}
      else $('#recovery-status').textContent=receipt&&['confirmed','finalized'].includes(receipt.confirmationStatus)?'Transaction confirmed. This alone does not prove mint policy or registration. Inspect the mint and receipt; no new transaction was sent.':'No confirmed result found. Do not assume failure or resend. Check again later.';
    }catch(error){$('#recovery-status').textContent=error.message;}finally{button.disabled=false;}
  });
  recovery.querySelectorAll('[data-register]').forEach(button=>button.onclick=()=>{const row=readLaunchJournal().find(r=>r.id===button.dataset.register);window.dispatchEvent(new CustomEvent('funded:recover-registration',{detail:{mint:row.mint,id:row.id}}));});
}
window.addEventListener('funded:journal',renderRecovery);window.addEventListener('funded:recovery-result',event=>{$('#recovery-status').textContent=event.detail;});renderRecovery();

const preferences=document.createElement('section');preferences.className='adoption-panel';preferences.id='community-preferences';
preferences.innerHTML='<h2>Following & updates</h2><p>Following works without buying. Optionally save or restore your list using your signed-in X account.</p><div class="support-actions"><button id="save-following">Save following to my X account</button><button id="restore-following">Restore saved following</button></div><label><input id="updates-consent" type="checkbox">Show followed creator updates in this app (refresh at most once a minute while visible)</label><button id="updates-refresh">Refresh followed updates</button><p id="following-status" role="status"></p><div id="following-updates"></div><details><summary>Private product diagnostics</summary><label><input id="diagnostics-consent" type="checkbox">Count my navigation and launch stages on this device</label><p>No wallet addresses, text, handles or browsing URLs are collected. Nothing is sent to an analytics service. This does not measure unique users or retention.</p><pre id="diagnostics-summary"></pre><button id="diagnostics-clear">Clear local counters</button></details>';
$('#my-launches').append(preferences);
const feedControls=document.createElement('div');feedControls.className='support-actions';
feedControls.innerHTML='<button id="updates-previous" disabled>Previous creators</button><button id="updates-next" disabled>Next creators</button><button id="updates-first" disabled>Start over</button>';
$('#following-updates').after(feedControls);
const updatesFeed=createFollowingFeed({
  load:async(ids,after,signal)=>{const params=new URLSearchParams({ids:ids.join(','),after});const result=await apiRequest(`/api/creator-support/following-updates?${params}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});if(!result.available)throw new Error('Unavailable');return result.data;},
  render:state=>{
    notificationCreators=state.creators;renderNotifications();
    $('#following-updates').innerHTML=state.creators.map(c=>`<article><a href="/creator/x/${esc(c.id)}">${esc(c.handle)}</a>${(c.updates||[]).map(update=>`<p>${esc(update.text)}</p><small>${esc(update.createdAt)}</small>`).join('')||'<p>No updates yet.</p>'}</article>`).join('');
    $('#updates-refresh').disabled=state.loading;
    $('#updates-refresh').textContent=state.error?'Retry followed updates':'Refresh followed updates';
    $('#updates-previous').disabled=!state.enabled||state.loading||!state.previous.length;
    $('#updates-next').disabled=!state.enabled||state.loading||!state.nextCursor;
    $('#updates-first').disabled=!state.enabled||state.loading||!state.after;
    $('#following-status').textContent=!state.enabled?'Enable in-app updates to load your followed creators.':state.loading?'Loading this page of followed creators…':state.error||(!state.requestedCount?'Follow a creator to see updates here.':!state.checkedCount?`${state.requestedCount} follows ready. Refresh to load their updates.`:`Page ${state.previous.length+1} · Checked ${state.checkedCount} of ${state.requestedCount} follows. ${state.creators.length} available; excluded or unavailable accounts are omitted. Two latest updates per creator; no complete activity feed is implied.`);
  },
});
const updateFeedContext=()=>updatesFeed.setContext(following(),$('#updates-consent').checked);
$('#updates-previous').onclick=()=>void updatesFeed.previous();$('#updates-next').onclick=()=>void updatesFeed.next();$('#updates-first').onclick=()=>void updatesFeed.first();
for(const [id,key] of [['updates-consent','funded.updates.enabled'],['diagnostics-consent','funded.diagnostics.enabled']]){$(`#${id}`).checked=storeGet(key,false)===true;$(`#${id}`).onchange=()=>{if(id==='updates-consent')updateFeedContext();try{localStorage.setItem(key,JSON.stringify($(`#${id}`).checked));if(id==='updates-consent'&&$(`#${id}`).checked)void refreshUpdates();}catch{if(id==='updates-consent'){$(`#${id}`).checked=false;updateFeedContext();}$('#following-status').textContent='Preference could not be saved. Updates remain disabled.';}};}
async function syncFollowing(restore){try{const me=await apiRequest('/api/creator-support/me');if(!me.available||!me.data?.csrf)throw new Error('Sign in with X in Rewards first.');if(restore){const rows=me.data.profile?.following||[];localStorage.setItem('funded.creator.following',JSON.stringify(rows));updateFeedContext();if($('#updates-consent').checked)await refreshUpdates();else $('#following-status').textContent=`Restored ${rows.length} follows on this device. Updates remain disabled.`;}else{const response=await apiRequest('/api/creator-support/preferences',{method:'POST',headers:{'x-creator-csrf':me.data.csrf},body:{following:following()}});if(!response.available)throw new Error('API unavailable; following was not saved.');$('#following-status').textContent='Following saved to your X account.';}}catch(error){$('#following-status').textContent=error.message;}}
$('#save-following').onclick=()=>syncFollowing(false);$('#restore-following').onclick=()=>syncFollowing(true);
async function refreshUpdates(){updateFeedContext();if(!$('#updates-consent').checked||document.hidden)return;await updatesFeed.refresh();}
updateFeedContext();
window.addEventListener('funded:following',()=>{updateFeedContext();});
window.addEventListener('storage',event=>{if(event.key===null||['funded.creator.following','funded.updates.enabled'].includes(event.key)){$('#updates-consent').checked=storeGet('funded.updates.enabled',false)===true;updateFeedContext();}});
$('#updates-refresh').onclick=()=>{if(!$('#updates-consent').checked){$('#following-status').textContent='Enable in-app updates first.';return;}void refreshUpdates();};
setInterval(()=>{if(location.hash==='#my-launches')void refreshUpdates();},60000);
function diagnostic(event){if(!$('#diagnostics-consent').checked)return;try{const today=new Date().toISOString().slice(0,10);const rows=storeGet('funded.diagnostics.counts',{});rows[today]||={};rows[today][event]=(Number(rows[today][event])||0)+1;localStorage.setItem('funded.diagnostics.counts',JSON.stringify(Object.fromEntries(Object.entries(rows).slice(-30))));renderDiagnostics();}catch{}}
function renderDiagnostics(){$('#diagnostics-summary').textContent=JSON.stringify(storeGet('funded.diagnostics.counts',{}),null,2);}
$('#diagnostics-clear').onclick=()=>{localStorage.removeItem('funded.diagnostics.counts');renderDiagnostics();};renderDiagnostics();
window.addEventListener('hashchange',()=>{diagnostic('navigation');if(location.hash==='#my-launches')void refreshUpdates();});
window.addEventListener('funded:journal',()=>diagnostic(`launch-${readLaunchJournal().at(-1)?.state||'unknown'}`));
