import { APP_CLUSTER, APP_MAINNET_READ_ONLY } from './app-config.js';
import { createPilotRecorder, PILOT_STORAGE_KEY, PILOT_CONSENT_KEY, PILOT_EVENT_NAMES } from './pilot-metrics-model.js';
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
let channel;
try{channel=new BroadcastChannel('funded-pilot-consent');}catch{}
const broadcast=message=>{try{channel?.postMessage(message);}catch{}};
// Access to localStorage itself can throw in restricted browser contexts.
const storage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)};
const recorder=createPilotRecorder({storage,broadcast});
const serialized=Boolean(navigator.locks?.request);
async function withRecorder(action){
  try{return serialized?await navigator.locks.request('funded-pilot-record',action):await action();}
  catch(error){consent.checked=false;exportButton.disabled=true;role.disabled=false;source.disabled=false;status.textContent=error.message;}
}
function render(message){
  let record;
  try{record=recorder.current();}catch(error){message=error.message;}
  consent.checked=Boolean(record);consent.disabled=!pilotEnabled;exportButton.disabled=!record;role.disabled=Boolean(record)||!pilotEnabled;source.disabled=Boolean(record)||!pilotEnabled;
  if(record){role.value=record.role;source.value=record.source;
    status.textContent=message || (record.coverageEndedAt?'Local event capacity reached. Recording paused; export or delete this record.':`Local recording on · ${record.events.length} events. Detailed cohort results are available by analyzing an export you consent to share.`);
  }else status.textContent=message || 'Pilot recording is off.';
  if(!pilotEnabled)status.textContent='Local pilot recording is available only on Devnet. Existing records can still be exported or deleted.';
  if(record?.cluster==='unknown')status.textContent+=' Legacy record network is unknown; it is not counted as Devnet evidence.';
  if(record && !serialized)status.textContent+=' Use one pilot tab: this browser cannot serialize changes across tabs.';
}
function recordEvent(name){
  if(!pilotEnabled || !PILOT_EVENT_NAMES.includes(name))return;
  const context={incentive:incentive.value,prompt:prompt.value};
  return withRecorder(()=>{try{recorder.record(name,context);render();}catch(error){render(error.message);}});
}
consent.addEventListener('change',()=>{const enabled=consent.checked;return withRecorder(()=>{
  try{
    if(enabled){if(!pilotEnabled)throw new Error('Local pilot recording is available only on Devnet.');recorder.enable({role:role.value,source:source.value,cluster:APP_CLUSTER});recorder.record('pilot-enrolled',{incentive:incentive.value,prompt:prompt.value});}
    else recorder.revoke();
    render();
  }catch(error){render(error.message);}
});});
section.querySelector('[data-pilot-clear]').addEventListener('click',()=>withRecorder(()=>{
  try{recorder.revoke();render('Local pilot record deleted. Recording is off.');}catch(error){render(error.message);}
}));
exportButton.addEventListener('click',()=>withRecorder(()=>{
  try{
    const record=recorder.export({observe:pilotEnabled});if(!record){render();return;}
    const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=`funded-pilot-${new Date().toISOString().slice(0,10)}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);render('Local record exported. Share it only if you consent to the recipient using it.');
  }catch(error){render(error.message);}
}));
channel?.addEventListener('message',event=>{if(event.data?.type==='revoked'){recorder.receiveRevocation();void withRecorder(()=>render('Pilot recording was stopped in another tab.'));}});
window.addEventListener('storage',event=>{
  if(![null,PILOT_STORAGE_KEY,PILOT_CONSENT_KEY].includes(event.key))return;
  if(event.key===null || event.key===PILOT_STORAGE_KEY && event.newValue===null || event.key===PILOT_CONSENT_KEY && event.newValue==='off')recorder.receiveRevocation();
  void withRecorder(()=>render());
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
void withRecorder(()=>render());trackUsefulView();
