import { apiRequest } from './client.js';
import { PRODUCT_EVENTS, productCounterExport } from './product-events.js';
import { readLaunchJournal, recordLaunchEvent, policyMatchesJournal } from './launch-journal.js';
import { notificationItems } from './notification-model.js';
import { createFollowingFeed } from './following-feed.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storeGet=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const following=()=>{const list=storeGet('funded.creator.following',[]);return Array.isArray(list)?list.filter(id=>/^\d{1,24}$/.test(id)).slice(0,200):[];};
function followingForAccountSave(){
  let raw;
  try { raw=localStorage.getItem('funded.creator.following'); }
  catch { throw new Error('Your local following list could not be read. Nothing was sent to your X account. Allow browser storage and try Save again.'); }
  if(raw===null)throw new Error('No local following list is saved on this device. Restore saved following or follow a creator before saving to your X account.');
  let rows;
  try { rows=JSON.parse(raw); }
  catch { throw new Error('Your local following list is unreadable. Nothing was sent to your X account. Restore saved following to recover your account list.'); }
  if(!Array.isArray(rows)||rows.length>200||rows.some(id=>typeof id!=='string'||!/^\d{1,24}$/.test(id)))
    throw new Error('Your local following list must contain up to 200 valid creator IDs. Nothing was sent to your X account. Review your following or restore your saved account list.');
  return [...new Set(rows)];
}
let notificationCreators=[];
function renderNotifications(){
  const dialog=$('#notification-dialog');if(!dialog)return;
  const read=storeGet('funded.notifications.read',[]),readIds=new Set(Array.isArray(read)?read:[]);
  const followed=new Set(following());
  const rows=notificationItems([],storeGet('funded.updates.enabled',false)===true?notificationCreators.filter(creator=>followed.has(creator?.id)):[]);
  const unread=rows.filter(row=>!readIds.has(row.id)).length;
  dialog.querySelector('h2').textContent=unread?`${unread} unread app updates`:'App updates';
  dialog.querySelector('.notice-list').innerHTML=`<p>Updates from creators you follow. Shown only in this app.</p>${rows.map(row=>`<article><small>${esc(row.kind)}${readIds.has(row.id)?' · read':''}</small><h3>${esc(row.title)}</h3><p>${esc(row.text)}</p><a href="${esc(row.href)}">Review</a>${readIds.has(row.id)?'':`<button type="button" data-notice-read="${esc(row.id)}">Mark read</button>`}</article>`).join('')||'<p>No followed creator updates loaded. Manage updates in Portfolio.</p>'}<p id="notification-save-status" role="status"></p>`;
  dialog.querySelectorAll('a').forEach(link=>link.onclick=()=>dialog.close());
  dialog.querySelectorAll('[data-notice-read]').forEach(button=>button.onclick=()=>{try{localStorage.setItem('funded.notifications.read',JSON.stringify([...new Set([...readIds,button.dataset.noticeRead])].slice(-200)));renderNotifications();}catch{$('#notification-save-status').textContent='Read status could not be saved on this device.';}});
  $('#notifications-button')?.setAttribute('aria-label',unread?`Notifications, ${unread} unread`:'Notifications');
}
$('#notifications-button')?.addEventListener('click',renderNotifications);
renderNotifications();

const imageTools=document.createElement('div');imageTools.className='adoption-tools image-picker-actions';
imageTools.innerHTML='<button type="button" id="image-upload" aria-label="Upload token image" title="Upload image"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5"/></svg></button><button type="button" id="image-remove" aria-label="Delete token image" title="Delete image" disabled><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button><p id="image-preparation-status" class="sr-only" role="status" aria-live="polite">No image selected.</p>';
const imageInput=$('#token-image');$('#token-image-picker')?.append(imageTools);
$('#image-upload').onclick=event=>{event.preventDefault();event.stopPropagation();imageInput.click();};
$('#image-remove').onclick=event=>{event.preventDefault();event.stopPropagation();imageInput.value='';imageInput.dispatchEvent(new Event('change',{bubbles:true}));};

async function reconcileRegisteredLaunches(){
  try {
    const response=await apiRequest('/api/launches');
    if(!response.available||!Array.isArray(response.data))return;
    for(const row of readLaunchJournal()) {
      if(!['unknown','confirmed','verification-pending','registration-pending'].includes(row.state)||!row.signature)continue;
      const registered=response.data.find(policy=>policy.pumpFeeRoute?.verified===true&&policyMatchesJournal(policy,row));
      if(registered)recordLaunchEvent(row.id,{state:'completed',mint:row.mint,signature:row.signature});
    }
  } catch { /* Keep uncertain local history when registry verification is unavailable. */ }
}
void reconcileRegisteredLaunches();

const preferences=document.createElement('section');preferences.className='adoption-panel';preferences.id='community-preferences';
preferences.innerHTML='<h2>Creators you follow</h2><p>Keep up with creators without buying their tokens. Save or restore your creator list with your X account. Your token watchlist stays on this device.</p><div class="support-actions"><button id="save-following">Save following to my X account</button><button id="restore-following">Restore saved following</button></div><label><input id="updates-consent" type="checkbox">Show creator updates in this app</label><p class="field-help">Updates refresh while this page is open.</p><button id="updates-refresh" hidden>Refresh followed updates</button><p id="following-status" role="status">Enable in-app updates to load your followed creators.</p><div id="following-updates"></div><details><summary>Private product diagnostics</summary><label><input id="diagnostics-consent" type="checkbox" aria-describedby="diagnostics-status">Count product steps on this device</label><p id="diagnostics-status" role="status" aria-live="polite"></p><p>These device-only counters stay in this browser and contain no wallet addresses, text, handles, or browsing URLs. Anonymous sharing below is a separate choice. Device-only counters do not measure unique users or retention.</p><pre id="diagnostics-summary"></pre><button id="diagnostics-clear">Clear local counters</button></details>';
preferences.querySelector('details > summary').textContent = 'Privacy controls';
$('#community').append(preferences);
const feedControls=document.createElement('div');feedControls.className='support-actions';feedControls.hidden=true;
feedControls.innerHTML='<button id="updates-previous" disabled>Previous creators</button><button id="updates-next" disabled>Next creators</button><button id="updates-first" disabled>Start over</button>';
$('#following-updates').after(feedControls);
const updatesFeed=createFollowingFeed({
  load:async(ids,after,signal)=>{const params=new URLSearchParams({ids:ids.join(','),after});const result=await apiRequest(`/api/creator-support/following-updates?${params}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});if(!result.available)throw new Error('Unavailable');return result.data;},
  render:state=>{
    notificationCreators=state.creators;renderNotifications();
    $('#following-updates').innerHTML=state.creators.map(c=>`<article><a href="/creator/x/${esc(c.id)}">${esc(c.handle)}</a>${(c.updates||[]).map(update=>`<p>${esc(update.text)}</p><small>${esc(update.createdAt)}</small>`).join('')||'<p>No updates yet.</p>'}</article>`).join('');
    $('#updates-refresh').disabled=state.loading;
    $('#updates-refresh').hidden=!state.enabled;
    feedControls.hidden=!state.enabled||(!state.previous.length&&!state.nextCursor);
    $('#updates-refresh').textContent=state.error?'Retry followed updates':'Refresh followed updates';
    $('#updates-previous').disabled=!state.enabled||state.loading||!state.previous.length;
    $('#updates-next').disabled=!state.enabled||state.loading||!state.nextCursor;
    $('#updates-first').disabled=!state.enabled||state.loading||!state.after;
    $('#following-status').textContent=!state.enabled?'Enable in-app updates to load your followed creators.':state.loading?'Loading creator updates…':state.error||(!state.requestedCount?'Follow a creator to see updates here.':!state.checkedCount?`${state.requestedCount} follows ready. Refresh to load their updates.`:`Page ${state.previous.length+1} · Checked ${state.checkedCount} of ${state.requestedCount} creators. Showing up to two recent updates per available creator.`);
  },
});
const updateFeedContext=()=>updatesFeed.setContext(following(),$('#updates-consent').checked);
$('#updates-previous').onclick=()=>void updatesFeed.previous();$('#updates-next').onclick=()=>void updatesFeed.next();$('#updates-first').onclick=()=>void updatesFeed.first();
for(const [id,key] of [['updates-consent','funded.updates.enabled']]){$(`#${id}`).checked=storeGet(key,false)===true;$(`#${id}`).onchange=()=>{if(id==='updates-consent')updateFeedContext();try{localStorage.setItem(key,JSON.stringify($(`#${id}`).checked));if(id==='updates-consent'&&$(`#${id}`).checked)void refreshUpdates();}catch{if(id==='updates-consent'){$(`#${id}`).checked=false;updateFeedContext();}$('#following-status').textContent='Preference could not be saved. Updates remain disabled.';}};}
async function syncFollowing(restore){
  let accountSaveRequested=false;
  try{
    // Capture explicit Save intent before the identity request; rendering's
    // empty fallback must never become a destructive account update.
    const rowsToSave=restore?null:followingForAccountSave();
    const me=await apiRequest('/api/creator-support/me');
    if(!me.available||!me.data?.csrf)throw new Error('Sign in with X in Rewards first.');
    if(restore){
      const rows=me.data.profile?.following||[];
      localStorage.setItem('funded.creator.following',JSON.stringify(rows));
      updateFeedContext();
      if($('#updates-consent').checked)await refreshUpdates();
      else $('#following-status').textContent=`Restored ${rows.length} follows on this device. Updates remain disabled.`;
    }else{
      accountSaveRequested=true;
      const response=await apiRequest('/api/creator-support/preferences',{method:'POST',headers:{'x-creator-csrf':me.data.csrf},body:{following:rowsToSave}});
      if(!response.available)throw new Error('Account save unconfirmed');
      $('#following-status').textContent='Following saved to your X account.';
    }
  }catch(error){$('#following-status').textContent=accountSaveRequested
    ? 'The account save could not be confirmed. Your saved list may have changed. Review your local following and try Save again.'
    : error.message;}
}
$('#save-following').onclick=()=>syncFollowing(false);$('#restore-following').onclick=()=>syncFollowing(true);
async function refreshUpdates(){updateFeedContext();if(!$('#updates-consent').checked||document.hidden)return;await updatesFeed.refresh();}
updateFeedContext();
window.addEventListener('funded:following',()=>{updateFeedContext();});
window.addEventListener('storage',event=>{if(event.key===null||['funded.creator.following','funded.updates.enabled'].includes(event.key)){$('#updates-consent').checked=storeGet('funded.updates.enabled',false)===true;updateFeedContext();}});
$('#updates-refresh').onclick=()=>{if(!$('#updates-consent').checked){$('#following-status').textContent='Enable in-app updates first.';return;}void refreshUpdates();};
setInterval(()=>{if(location.hash==='#community')void refreshUpdates();},60000);
const diagnosticsConsent=$('#diagnostics-consent'),diagnosticsStatus=$('#diagnostics-status');
const diagnosticsConsentKey='funded.diagnostics.enabled',diagnosticsCountsKey='funded.diagnostics.counts';
let diagnosticsStopped=false;
function stopDiagnostics(message){
  diagnosticsStopped=true;diagnosticsConsent.checked=false;diagnosticsStatus.textContent=message;
}
function readDiagnostics(){
  const rows=JSON.parse(localStorage.getItem(diagnosticsCountsKey)||'{}');
  if(!rows || typeof rows!=='object' || Array.isArray(rows))throw new Error('Invalid counters');
  return rows;
}
function renderDiagnostics(){
  try{$('#diagnostics-summary').textContent=JSON.stringify(readDiagnostics(),null,2);return true;}
  catch{stopDiagnostics('Local counters could not be read. Counting stopped in this tab. Allow browser storage and reload to review your saved setting.');return false;}
}
try{diagnosticsConsent.checked=localStorage.getItem(diagnosticsConsentKey)==='true';}
catch{stopDiagnostics('Your diagnostics preference could not be read. Counting is off in this tab. Allow browser storage and reload to try again.');}
diagnosticsConsent.onchange=()=>{
  const enabled=diagnosticsConsent.checked;
  // The checkbox represents a saved choice, never an optimistic storage write.
  diagnosticsConsent.checked=false;
  if(!enabled)diagnosticsStopped=true;
  try{
    localStorage.setItem(diagnosticsConsentKey,String(enabled));
    if(localStorage.getItem(diagnosticsConsentKey)!==String(enabled))throw new Error('Preference not saved');
    diagnosticsStopped=!enabled;diagnosticsConsent.checked=enabled;
    diagnosticsStatus.textContent=enabled?'Product step counting is on for this device. Nothing is uploaded.':'Product step counting is off. Existing local counters were kept.';
  }catch{
    stopDiagnostics('Your diagnostics preference could not be saved. Counting stopped in this tab; the saved setting may be unchanged. Allow browser storage and reload to review it.');
  }
};
function diagnostic(event){
  if(diagnosticsStopped || !diagnosticsConsent.checked || !PRODUCT_EVENTS.has(event))return;
  try{
    if(localStorage.getItem(diagnosticsConsentKey)!=='true'){stopDiagnostics('Product step counting was turned off. Existing local counters were kept.');return;}
    const today=new Date().toISOString().slice(0,10),rows=readDiagnostics();
    rows[today]??={};
    if(typeof rows[today]!=='object' || Array.isArray(rows[today]))throw new Error('Invalid counters');
    const count=rows[today][event]??0;
    if(!Number.isSafeInteger(count) || count<0 || count===Number.MAX_SAFE_INTEGER)throw new Error('Invalid count');
    rows[today][event]=count+1;
    if(localStorage.getItem(diagnosticsConsentKey)!=='true'){stopDiagnostics('Product step counting was turned off. Existing local counters were kept.');return;}
    localStorage.setItem(diagnosticsCountsKey,JSON.stringify(Object.fromEntries(Object.entries(rows).slice(-30))));
    if(localStorage.getItem(diagnosticsConsentKey)!=='true'){stopDiagnostics('Product step counting was turned off. Existing local counters were kept.');return;}
    renderDiagnostics();
  }catch{stopDiagnostics('Local counters could not be updated. Counting stopped in this tab. Allow browser storage and reload to review your saved setting.');}
}
$('#diagnostics-clear').onclick=()=>{
  try{
    localStorage.removeItem(diagnosticsCountsKey);
    if(!renderDiagnostics())return;
    diagnosticsStatus.textContent=`Local counters cleared. Product step counting ${!diagnosticsStopped && diagnosticsConsent.checked?'remains on':'is off in this tab'}.`;
  }catch{stopDiagnostics('Local counters could not be cleared. Saved data may remain. Counting stopped in this tab; allow browser storage and try Clear local counters again.');}
};
window.addEventListener('storage',event=>{
  // Honor an off notification directly: another renderer's localStorage cache
  // can lag. A remote opt-in never reverses this tab's explicit/failure stop.
  if(event.key===null || event.key===diagnosticsConsentKey && event.newValue!=='true'){
    stopDiagnostics(event.key===null?'Browser data was cleared in another tab. Product step counting stopped.':'Product step counting was turned off in another tab. Existing local counters were kept.');
  }
  if(event.key===null || event.key===diagnosticsCountsKey)renderDiagnostics();
});
renderDiagnostics();
window.addEventListener('funded:product-event', event => diagnostic(event.detail?.name));
const exportCounters = document.createElement('button');
exportCounters.type = 'button'; exportCounters.textContent = 'Export local counters'; exportCounters.id = 'diagnostics-export';
$('#diagnostics-clear').after(exportCounters);
exportCounters.addEventListener('click', () => {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(productCounterExport(readDiagnostics()), null, 2)], { type:'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'funded-device-journeys.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { diagnosticsStatus.textContent = 'Could not export local counters. Try again after allowing downloads.'; }
});
diagnosticsConsent.parentElement.lastChild.textContent = ' Count product steps on this device';
window.addEventListener('hashchange',()=>{diagnostic('navigation');if(location.hash==='#community')void refreshUpdates();});
