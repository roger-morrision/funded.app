import {saveDevicePreferences} from './device-preference-storage.js';
import { panel, el, button } from './view-utils.js';
const KEY='funded.notification-preferences.v1';
export const notificationKinds=['launch','receipt','statement','trade','approval','cutoff'];
export function normalizeNotifications(value={}) {
  const hour=v=>Number.isInteger(v)&&v>=0&&v<24?v:0;
  return {enabled:value.enabled===true,types:Object.fromEntries(notificationKinds.map(kind=>[kind,value.types?.[kind]!==false])),
    minimumSol:typeof value.minimumSol==='string'&&/^(?:0|[1-9]\d{0,2})(?:\.\d{1,9})?$/.test(value.minimumSol)&&Number(value.minimumSol)<=100?value.minimumSol:'0',
    frequency:value.frequency==='digest'?'digest':'all',quiet:value.quiet===true,start:hour(value.start),end:hour(value.end)};
}
export function readNotifications(storage=globalThis.localStorage) {
  try {return normalizeNotifications(JSON.parse(storage.getItem(KEY)||JSON.stringify({enabled:storage.getItem('funded.creator-activity-alerts.v1')==='true'})));} catch{return normalizeNotifications();}
}
export function saveNotifications(value,storage=globalThis.localStorage) {
  const next=normalizeNotifications(value);saveDevicePreferences([[KEY,JSON.stringify(next)],['funded.creator-activity-alerts.v1',String(next.enabled)]],storage);
  globalThis.dispatchEvent?.(new Event('funded:notification-preferences'));return next;
}
export function notificationAllowed(prefs,kind,amountLamports=null,date=new Date()) {
  if(!prefs.enabled||!prefs.types[kind])return false;
  const hour=date.getHours();
  if(prefs.quiet&&prefs.start!==prefs.end&&(prefs.start<prefs.end?hour>=prefs.start&&hour<prefs.end:hour>=prefs.start||hour<prefs.end))return false;
  if(kind==='receipt'&&Number(prefs.minimumSol)>0){
    if(!/^\d+$/.test(String(amountLamports)))return false;
    const [whole,fraction='']=prefs.minimumSol.split('.');
    if(BigInt(amountLamports)<BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0')))return false;
  }
  return true;
}
export function initializeNotificationPreferences() {
  const parent=document.querySelector('#profile');if(!parent)return;
  const root=panel('notification-preferences','Notification preferences','Notices appear on this device while the app is open. Reminders stay available for manual review.');
  const form=el('form'),inputs={},labels={enabled:'Enable creator activity notices',launch:'Launches',receipt:'Verified payouts and burns',statement:'Creator updates',trade:'Observed trades',approval:'Ready approvals',cutoff:'Published payout cutoffs',quiet:'Use quiet hours'};
  const types=el('fieldset',null,'settings-option-grid'),quiet=el('fieldset',null,'settings-quiet-hours'),hours=el('div',null,'settings-hour-range'),rules=el('div',null,'settings-field-grid');
  types.append(el('legend','Activity types'));quiet.append(el('legend','Quiet hours'));
  const prefs=readNotifications();
  for(const key of Object.keys(labels)){const label=el('label',labels[key]),input=el('input');input.type='checkbox';input.checked=notificationKinds.includes(key)?prefs.types[key]:prefs[key];inputs[key]=input;label.prepend(input);(notificationKinds.includes(key)?types:key==='quiet'?quiet:form).append(label);}
  for(const [key,label,type] of [['minimumSol','Minimum receipt amount (SOL)','text'],['start','Quiet hours start (0–23)','number'],['end','Quiet hours end (0–23)','number']]){
    const wrap=el('label',label),input=el('input');input.type=type;input.value=prefs[key];if(type==='number'){input.min='0';input.max='23';input.step='1';}else input.inputMode='decimal';inputs[key]=input;wrap.append(input);(key==='minimumSol'?rules:hours).append(wrap);
  }
  const frequency=el('select');frequency.setAttribute('aria-label','Notice grouping');for(const [value,label] of [['all','Individual notices'],['digest','Digest by type and token']]){const option=el('option',label);option.value=value;frequency.append(option);}frequency.value=prefs.frequency;
  const grouping=el('label','Notice grouping');grouping.append(frequency);rules.append(grouping);quiet.append(hours,el('small','Hours use this browser’s local time.'));
  const status=el('p');status.setAttribute('role','status');form.append(types,rules,quiet,button('Save notification preferences',()=>{
    if(!form.reportValidity())return;const minimumSol=inputs.minimumSol.value.trim();
    if(!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,9})?$/.test(minimumSol)||Number(minimumSol)>100){status.textContent='Enter a SOL threshold from 0 to 100, with up to nine decimals.';return;}
    try{saveNotifications({enabled:inputs.enabled.checked,types:Object.fromEntries(notificationKinds.map(kind=>[kind,inputs[kind].checked])),minimumSol,frequency:frequency.value,quiet:inputs.quiet.checked,start:Number(inputs.start.value),end:Number(inputs.end.value)});status.textContent='Preferences saved on this device. USD thresholds require a verified current conversion and are unavailable.';}catch{status.textContent='Preferences could not be saved. Check browser storage.';}
  }),status);form.addEventListener('submit',event=>event.preventDefault());root.append(form);parent.append(root);
  window.addEventListener('funded:notification-preferences',()=>{const saved=readNotifications();inputs.enabled.checked=saved.enabled;});
}
