import bs58 from 'bs58';
const address=value=>{if(typeof value!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return false;try{return bs58.decode(value).length===32;}catch{return false;}};
const reminderRoute=href=>typeof href==='string'&&(/^\/creator\/x\/\d{1,24}$/.test(href)||href.startsWith('/token/')&&address(href.slice(7)));
function mergeWallets(rows){const wallets=new Map();for(const row of rows){const roles=[...new Set([...(wallets.get(row.address)?.roles||[]),...row.roles])];wallets.set(row.address,{address:row.address,roles});}return [...wallets.values()];}
export function validatePreferenceTransfer(value){
  if(!value||value.version!==1||Object.keys(value).some(key=>!['version','wallets','creators','reminders'].includes(key)))throw new Error('Use a version 1 preference export containing only wallets, creators, and reminders.');
  if(!Array.isArray(value.wallets)||value.wallets.length>200||value.wallets.some(row=>!row||!address(row.address)||!Array.isArray(row.roles)||row.roles.some(role=>!['creator','trader'].includes(role))))throw new Error('Choose up to 200 valid public followed wallets.');
  if(!Array.isArray(value.creators)||value.creators.length>200||value.creators.some(id=>typeof id!=='string'||!/^\d{1,24}$/.test(id)))throw new Error('Choose up to 200 valid creator accounts.');
  if(!Array.isArray(value.reminders)||value.reminders.length>50||value.reminders.some(row=>!row||!/^[a-f0-9-]{36}$/.test(row.id||'')||!Number.isFinite(row.at)||row.at<0||row.at>Date.now()+90*86400000||typeof row.label!=='string'||row.label.length>100||!reminderRoute(row.href)))throw new Error('Choose up to 50 reminders with allowed app routes and times.');
  return {version:1,wallets:mergeWallets(value.wallets),
    creators:[...new Set(value.creators)],reminders:[...new Map(value.reminders.map(({id,at,label,href})=>[id,{id,at,label,href}])).values()]};
}
export function mergePreferences(current,incoming){
  return validatePreferenceTransfer({version:1,wallets:mergeWallets([...current.wallets,...incoming.wallets]),creators:[...new Set([...current.creators,...incoming.creators])],reminders:[...new Map([...current.reminders,...incoming.reminders].map(row=>[row.id,row])).values()]});
}
