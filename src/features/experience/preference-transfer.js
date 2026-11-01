import { validatePreferenceTransfer, mergePreferences } from '../../../experience-preferences.js';
import { readReminders } from './creator-activity.js';
import { el, panel, button, array } from './view-utils.js';
export function initializePreferenceTransfer(app){
  const parent=document.querySelector('#profile');if(!parent)return;
  const root=panel('preference-transfer','Keep your follows and reminders','Back up follows and reminders, or review an import before applying it.');
  const text=el('textarea');text.rows=5;text.maxLength=100000;text.setAttribute('aria-label','Preference import or export JSON');
  const status=el('p');status.setAttribute('role','status');let prepared=null,owner=null;
  const read=()=>validatePreferenceTransfer({version:1,wallets:app.getFollowedWallets(),creators:array(JSON.parse(localStorage.getItem('funded.creator.following')||'[]')),reminders:readReminders()});
  const review=value=>{prepared=mergePreferences(read(),validatePreferenceTransfer(value));status.textContent=`Review merge: ${prepared.wallets.length} followed wallets, ${prepared.creators.length} creator accounts, ${prepared.reminders.length} reminders. Existing entries are preserved by public ID. Choose Apply reviewed merge.`;apply.disabled=false;};
  const apply=button('Apply reviewed merge',()=>{
    if(!prepared)return;
    const keys=[app.FOLLOWED_WALLETS_KEY,'funded.creator.following','funded.return-reminders.v1'],values=[prepared.wallets,prepared.creators,prepared.reminders],prior=keys.map(key=>localStorage.getItem(key));
    try{keys.forEach((key,index)=>localStorage.setItem(key,JSON.stringify(values[index])));app.lastKnownFollowedWallets=prepared.wallets;app.renderFollowedWallets();window.dispatchEvent(new Event('funded:following-changed'));window.dispatchEvent(new Event('storage'));status.textContent='Reviewed preferences merged on this device. No transaction was submitted.';prepared=null;apply.disabled=true;}
    catch{try{keys.forEach((key,index)=>prior[index]==null?localStorage.removeItem(key):localStorage.setItem(key,prior[index]));}catch{}status.textContent='Merge could not be saved. Storage may be unavailable; review saved preferences before retrying.';}
  });apply.disabled=true;
  const account=async()=>{const response=await app.apiRequest('/api/creator-support/me',{signal:AbortSignal.timeout(10000)});if(!response.available||!response.data?.user?.id||response.data.content?.preferenceSync!==true)throw new Error('Optional sync requires a verified X session and the updated API. Local export and import remain available.');return response.data;};
  root.append(button('Export current preferences',()=>{try{text.value=JSON.stringify(read(),null,2);status.textContent='Export prepared below. Copy it to a file you control.';}catch(error){status.textContent=error.message;}}),text,button('Review imported merge',()=>{try{owner=null;review(JSON.parse(text.value));}catch(error){status.textContent=error.message;}}),apply,
    button('Review saved account preferences',async()=>{try{const me=await account();owner=String(me.user.id);if(!me.profile?.workspacePreferences)throw new Error(`No preferences saved for @${me.user.username}.`);text.value=JSON.stringify(me.profile.workspacePreferences,null,2);review(me.profile.workspacePreferences);status.textContent=`Account @${me.user.username}: `+status.textContent;}catch(error){status.textContent=error.message;}}),
    button('Save device preferences to signed-in account',async()=>{try{const me=await account();const value=read();if(!confirm(`Save ${value.wallets.length} public wallet follows, ${value.creators.length} creator follows and ${value.reminders.length} reminders to @${me.user.username}?`))return;
      const current=await account();if(String(current.user.id)!==String(me.user.id))throw new Error('Account changed. Review the destination again.');const response=await app.apiRequest('/api/creator-support/device-preferences',{method:'POST',headers:{'x-creator-csrf':current.csrf},body:value,signal:AbortSignal.timeout(15000)});
      if(!response.available||response.data?.saved!==true)throw new Error('Save could not be verified. Check the account before retrying.');status.textContent=`Preferences saved to @${current.user.username}. Nothing is imported automatically.`;
    }catch(error){status.textContent=error.message;}}),status);parent.append(root);
  text.addEventListener('input',()=>{prepared=null;apply.disabled=true;});
  const [exportButton,reviewButton,,loadButton,saveButton]=root.querySelectorAll(':scope > button');
  exportButton.textContent='Export preferences';reviewButton.textContent='Review import';loadButton.textContent='Load from X account';saveButton.textContent='Save to X account';
  text.id='preference-transfer-data';text.setAttribute('aria-label','Follows & reminders data (Preference import or export JSON)');const dataLabel=el('label','Follows & reminders data');dataLabel.htmlFor=text.id;
  const device=el('section',null,'settings-transfer-section'),deviceHeading=el('h3','On this device');deviceHeading.id='settings-device-backup';device.setAttribute('aria-labelledby',deviceHeading.id);
  const actions=el('div',null,'settings-actions');actions.append(reviewButton,apply);device.append(deviceHeading,exportButton,dataLabel,text,actions);
  const sync=el('section',null,'settings-transfer-section'),syncHeading=el('h3','X account sync');syncHeading.id='settings-account-sync';sync.setAttribute('aria-labelledby',syncHeading.id);
  const accountActions=el('div',null,'settings-actions');accountActions.append(loadButton,saveButton);sync.append(syncHeading,el('p','Uses your signed-in X account. Wallets stay separate; nothing syncs automatically.'),accountActions);
  status.before(device,sync);
  window.addEventListener('funded:reward-identity-change',()=>{if(owner){prepared=null;owner=null;apply.disabled=true;status.textContent='Identity changed. Review the import again.';}});
}
