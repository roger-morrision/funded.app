const address=value=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value||''));
export function validatePreferenceTransfer(value){
  if(!value||value.version!==1||Object.keys(value).some(key=>!['version','wallets','creators','reminders'].includes(key)))throw new Error('Use a version 1 preference export containing only wallets, creators, and reminders.');
  if(!Array.isArray(value.wallets)||value.wallets.length>200||value.wallets.some(row=>!address(row.address)||!Array.isArray(row.roles)||row.roles.some(role=>!['creator','trader'].includes(role))))throw new Error('Choose up to 200 valid public followed wallets.');
  if(!Array.isArray(value.creators)||value.creators.length>200||value.creators.some(id=>typeof id!=='string'||!/^\d{1,24}$/.test(id)))throw new Error('Choose up to 200 valid creator accounts.');
  if(!Array.isArray(value.reminders)||value.reminders.length>50||value.reminders.some(row=>!/^[a-f0-9-]{36}$/.test(row.id||'')||!Number.isFinite(row.at)||row.at<0||row.at>Date.now()+90*86400000||typeof row.label!=='string'||row.label.length>100||!/^\/(?:token\/[1-9A-HJ-NP-Za-km-z]{32,44}|creator\/x\/\d{1,24})$/.test(row.href)))throw new Error('Choose up to 50 reminders with allowed app routes and times.');
  return {version:1,wallets:[...new Map(value.wallets.map(row=>[row.address,{address:row.address,roles:[...new Set(row.roles)]}])).values()],
    creators:[...new Set(value.creators)],reminders:[...new Map(value.reminders.map(({id,at,label,href})=>[id,{id,at,label,href}])).values()]};
}
export function mergePreferences(current,incoming){
  return validatePreferenceTransfer({version:1,wallets:[...new Map([...current.wallets,...incoming.wallets].map(row=>[row.address,row])).values()],creators:[...new Set([...current.creators,...incoming.creators])],reminders:[...new Map([...current.reminders,...incoming.reminders].map(row=>[row.id,row])).values()]});
}
