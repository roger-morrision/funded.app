import { APP_CLUSTER, APP_MAINNET_READ_ONLY } from './app-config.js';
import { createPilotRecorder, PILOT_EVENT_NAMES } from './pilot-metrics-model.js';
import { createPilotStorage } from './pilot-storage.js';
import './pilot-metrics.css';

const pilotEnabled=APP_CLUSTER==='devnet' && !APP_MAINNET_READ_ONLY;
const section=document.createElement('section');
section.className='pilot-panel';section.id='pilot-local-panel';
section.innerHTML=`<h2>Optional local pilot setup</h2><p>Record your creator or community journey on this device. This does not register you in a central participant list. Nothing is uploaded; sharing an export is a separate choice. No wallet address, token address, post text, or browsing URL is recorded.</p>
<div class="pilot-fields"><label>Your role<select data-pilot-role><option value="unknown">Choose a role</option><option value="creator">Creator</option><option value="community">Community participant</option></select></label>
<label>How did you arrive?<select data-pilot-source><option value="unknown">Prefer not to say / unknown</option><option value="creator-invite">Creator invite</option><option value="organic">Found it myself</option><option value="other">Other</option><option value="test">Test or synthetic fixture</option><option value="bot">Automated / bot session</option></select></label></div>
<label class="pilot-consent"><input type="checkbox" data-pilot-consent> Record pilot events on this device</label>
<p class="pilot-help">Role and arrival source stay fixed for this local record. Delete it before starting a different record; re-enrollment is not evidence of another person.</p>
<fieldset class="pilot-session"><legend>Optional context for this visit</legend><p>These answers apply to future events in this visit and reset to unknown when the page reloads. A creator invite does not establish whether an incentive was offered.</p>
<div class="pilot-fields"><label>Was participation encouraged with an incentive?<select data-pilot-incentive><option value="unknown">Unknown / prefer not to say</option><option value="none">No incentive offered</option><option value="offered">An incentive was offered</option></select></label>
<label>What prompted this visit?<select data-pilot-prompt><option value="unknown">Unknown / prefer not to say</option><option value="voluntary">I returned on my own</option><option value="reminder">A reminder or invitation</option></select></label></div></fieldset>
<div class="pilot-actions"><button type="button" data-pilot-export disabled>Export local record</button><button type="button" data-pilot-clear>Delete local record</button></div>
<p data-pilot-status role="status" aria-live="polite">Pilot recording is off.</p><small>D1, D7, and D30 results need a complete observed UTC day after activation. Missing follow-up remains unknown. Counts describe local device records, not unique people. Previously shared exports must also be deleted by their recipient.</small>`;
const target=document.querySelector('#creator-pilot-metrics');
if(target)target.replaceChildren(section);else document.querySelector('#community-preferences')?.after(section);
const consent=section.querySelector('[data-pilot-consent]'),role=section.querySelector('[data-pilot-role]'),source=section.querySelector('[data-pilot-source]'),status=section.querySelector('[data-pilot-status]'),exportButton=section.querySelector('[data-pilot-export]');
const incentive=section.querySelector('[data-pilot-incentive]'),prompt=section.querySelector('[data-pilot-prompt]');
const clearButton=section.querySelector('[data-pilot-clear]');
const persistence=createPilotStorage();
const recorder=createPilotRecorder({storage:persistence.storage});
let committedRecord=null, committedConsentEpoch=0, initialized=false, generation=0;
let pending=0, controlPending=0, deletionPending=0, storageFailed=false, legacyCleanupFailed=false;
let notice='Checking local pilot storage…';
let channel;
try{channel=new BroadcastChannel('funded-pilot-consent');}catch{}
// This key carries invalidations only. Neither it nor legacy localStorage
// records authorize recording; the committed IndexedDB snapshot does.
const signalKey='funded.pilot.storage-signal.v3', seenSignals=new Set();
function broadcast(type){
  const message={type,id:crypto.randomUUID()};
  try{channel?.postMessage(message);}catch{}
  try{localStorage.setItem(signalKey,JSON.stringify(message));}catch{}
}
function render(message){
  if(message!==undefined)notice=message;
  const record=committedRecord;
  section.setAttribute('aria-busy',String(pending>0 || !initialized && !storageFailed));
  consent.checked=Boolean(record);
  consent.disabled=!pilotEnabled || !initialized || storageFailed || controlPending>0 || deletionPending>0;
  exportButton.disabled=!record || pending>0 || storageFailed;
  clearButton.disabled=deletionPending>0;
  role.disabled=Boolean(record) || !pilotEnabled || !initialized || controlPending>0;
  source.disabled=role.disabled;
  if(record){role.value=record.role;source.value=record.source;}
  status.textContent=notice || (record
    ? record.coverageEndedAt?'Local event capacity reached. Recording paused; export or delete this record.':`Local recording on · ${record.events.length} events. Detailed cohort results are available by analyzing an export you consent to share.`
    : 'Pilot recording is off.');
  if(!pilotEnabled){
    const networkNotice='Local pilot recording is available only on Devnet. Existing records can still be exported or deleted.';
    status.textContent=notice?`${notice} ${networkNotice}`:networkNotice;
  }
  if(record?.cluster==='unknown')status.textContent+=' Legacy record network is unknown; it is not counted as Devnet evidence.';
  if(legacyCleanupFailed)status.textContent+=' Older browser data could not be cleared. Close older pilot tabs and clear this site’s browser data before using them again.';
}
async function withRecorder(action,{epoch=generation,control=false,...options}={}){
  pending++;if(control)controlPending++;render();
  try{
    const result=await persistence.run(()=>{
      if(epoch!==generation)return {stale:true};
      return action();
    },options);
    if(epoch!==generation || result.value?.stale)return null;
    committedRecord=result.value.record;
    committedConsentEpoch=result.consentEpoch;
    initialized=true;storageFailed=false;legacyCleanupFailed=result.legacyCleanupFailed;
    render(result.value.message ?? '');
    if(result.changed)broadcast('changed');
    return result.value;
  }catch(error){
    if(epoch!==generation)return null;
    recorder.receiveRevocation();committedRecord=null;generation++;
    if(error.code==='PILOT_CONSENT_CHANGED'){
      // A delayed opt-in may not undo a newer revocation. Read the new fence
      // before allowing another explicit choice; never retry the opt-in.
      render(error.message);
      await withRecorder(()=>({record:null,message:error.message}),{control:true});
    }else{
      storageFailed=true;
      render(`${options.revoke?'Recording stopped in this tab, but saved data could not be cleared. Close other pilot tabs and clear this site’s browser data to remove it. ':''}${error.message} Enable browser storage, close other pilot tabs, then reload to try again.`);
    }
    return null;
  }finally{pending--;if(control)controlPending--;render();}
}
function recordEvent(name){
  if(!pilotEnabled || !initialized || storageFailed || !committedRecord || !PILOT_EVENT_NAMES.includes(name))return;
  const context={incentive:incentive.value,prompt:prompt.value};
  const participantId=committedRecord.participantId;
  return withRecorder(()=>{
    const record=recorder.current();
    // The event belongs only to the consent active when it occurred.
    if(record?.participantId!==participantId)return {record};
    recorder.record(name,context);return {record:recorder.current()};
  });
}
async function revoke({remote=false}={}){
  generation++;recorder.receiveRevocation();committedRecord=null;
  deletionPending++;render(remote?'Pilot recording was stopped in another tab. Saving this choice…':'Recording stopped. Deleting the local record…');
  if(!remote)broadcast('revoked');
  try{
    await withRecorder(()=>{
      recorder.revoke();return {record:null,message:remote?'Pilot recording was stopped in another tab.':'Local pilot record deleted. Recording is off.'};
    },{clearLegacy:true,revoke:true,control:true});
    if(legacyCleanupFailed && !storageFailed)render('Recording is off. The current pilot record was cleared, but older saved data could not be cleared.');
  }finally{deletionPending--;render();}
}
consent.addEventListener('change',()=>{
  const enabled=consent.checked;
  const profile={role:role.value,source:source.value,cluster:APP_CLUSTER};
  const context={incentive:incentive.value,prompt:prompt.value};
  const expectedConsentEpoch=committedConsentEpoch;
  // Native checkbox changes are optimistic; display only committed consent.
  render();
  if(!enabled)return revoke();
  if(!pilotEnabled || !initialized || storageFailed)return;
  if(!['creator','community'].includes(profile.role)){render('Choose a creator or community role before enabling local recording.');return;}
  render('Saving your local pilot choice…');
  return withRecorder(()=>{
    try{recorder.enable(profile);recorder.record('pilot-enrolled',context);return {record:recorder.current()};}
    catch(error){if(error.code==='PILOT_PROFILE_CONFLICT')return {record:recorder.current(),message:error.message};throw error;}
  },{control:true,expectedConsentEpoch});
});
clearButton.addEventListener('click',()=>revoke());
exportButton.addEventListener('click',async()=>{
  const epoch=generation, participantId=committedRecord?.participantId;
  if(!participantId || storageFailed)return;
  const result=await withRecorder(()=>{
    const record=recorder.current();
    if(record?.participantId!==participantId)return {record};
    const exported=recorder.export({observe:pilotEnabled});
    return {record:recorder.current(),exported};
  },{epoch,control:true});
  if(!result?.exported || epoch!==generation)return;
  try{
    const blob=new Blob([JSON.stringify(result.exported,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=`funded-pilot-${new Date().toISOString().slice(0,10)}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);render('Local record exported. Share it only if you consent to the recipient using it.');
  }catch{render('The local record could not be downloaded. Retry Export local record.');}
});
function receiveSignal(message){
  if(!message || !['changed','revoked'].includes(message.type))return;
  if(message.id){if(seenSignals.has(message.id))return;seenSignals.add(message.id);if(seenSignals.size>100)seenSignals.delete(seenSignals.values().next().value);}
  if(message.type==='revoked'){void revoke({remote:true});return;}
  if(storageFailed)return;
  void withRecorder(()=>({record:recorder.current(),message:notice}));
}
channel?.addEventListener('message',event=>receiveSignal(event.data));
window.addEventListener('storage',event=>{
  // Legacy cleanup writes an off marker on every successful transaction.
  // Treating those writes as IDB revocation would stop consenting new tabs.
  if(event.key!==signalKey || !event.newValue)return;
  try{receiveSignal(JSON.parse(event.newValue));}catch{}
});
window.addEventListener('funded:pilot-event',event=>recordEvent(event.detail?.name));
document.querySelector('#token-name')?.addEventListener('input',event=>{if(event.target.value.trim())recordEvent('draft-started');});
window.addEventListener('funded:launch-step',event=>{if(event.detail?.step===3)recordEvent('draft-reviewed');});
window.addEventListener('funded:watchlist-added',()=>recordEvent('save-coin'));
function followingCount(){try{const list=JSON.parse(localStorage.getItem('funded.creator.following')||'[]');return Array.isArray(list)?list.length:0;}catch{return 0;}}
let priorFollowingCount=followingCount();
window.addEventListener('funded:following',()=>{const next=followingCount();if(next>priorFollowingCount)recordEvent('follow-creator');priorFollowingCount=next;});
window.addEventListener('funded:verified-reward-view',()=>recordEvent('verified-reward-view'));
window.addEventListener('funded:creator-update-published',()=>recordEvent('creator-update-published'));
window.addEventListener('funded:jackpot-pilot',event=>{if(['jackpot-home-view','jackpot-rewards-view','jackpot-open','jackpot-rules-view'].includes(event.detail?.name))recordEvent(event.detail.name);});
function trackUsefulView(){
  const hash=location.hash.split('?')[0];
  if(hash==='#pilot' || !hash && /^\/pilot\/?$/.test(location.pathname))recordEvent('pilot-open');
  const token=location.pathname.match(/^\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})$/)?.[1];
  const creator=location.hash.match(/^#creator\/(\d{1,24})$/)?.[1] || location.pathname.match(/^\/creator\/x\/(\d{1,24})\/?$/)?.[1];
  try{
    if(token && JSON.parse(localStorage.getItem('funded.app.community.watchlist')||'[]').includes(token))recordEvent('watched-coin-view');
    if(creator && document.querySelector('#creator-support-page .creator-updates article') && JSON.parse(localStorage.getItem('funded.creator.following')||'[]').includes(creator))recordEvent('followed-creator-view');
  }catch{}
}
window.addEventListener('popstate',trackUsefulView);window.addEventListener('hashchange',trackUsefulView);
const creatorPage=document.querySelector('#creator-support-page');
if(creatorPage)new MutationObserver(trackUsefulView).observe(creatorPage,{childList:true,subtree:true});
render();
void withRecorder(()=>({record:recorder.current()})).then(trackUsefulView);
