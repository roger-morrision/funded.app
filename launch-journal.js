import { productEvent } from './product-events.js';
export const JOURNAL_KEY = 'funded.launch.journal.v1';
const states = new Set(['prepared','awaiting-approval','broadcasting','submitted','confirmed','verification-pending','registration-pending','completed','failed','cancelled','unknown']);
const fields = ['state','step','mint','signature','payer','cluster','name','symbol','message','lastValidBlockHeight'];
const uncertain=new Set(['prepared','awaiting-approval','broadcasting','submitted','unknown','confirmed','verification-pending','registration-pending']);
export function pendingLaunchReceipts(row){
  const receipts=new Map();
  for(const event of Array.isArray(row.events)?row.events:[])
    if(event?.step&&event.signature&&['broadcasting','submitted','unknown','confirmed','failed','cancelled'].includes(event.state))
      receipts.set(event.signature,event);
  return [...receipts.values()].filter(event=>['broadcasting','submitted','unknown'].includes(event.state));
}
const needsRecovery=row=>pendingLaunchReceipts(row).length>0||row.state!=='completed'&&(uncertain.has(row.state)||row.signature
  ||Array.isArray(row.events)&&row.events.some(event=>event?.signature||['broadcasting','submitted','unknown','confirmed','verification-pending','registration-pending'].includes(event?.state)));
function retainRows(rows){
  const recent=new Set(rows.slice(-50));
  return rows.filter(row=>recent.has(row)||needsRecovery(row));
}
function retainEvents(events){const recent=new Set(events.slice(-60));return events.filter(event=>recent.has(event)||event.signature);}
function publicRows(rows){
  if(!Array.isArray(rows))return [];
  return retainRows(rows.filter(row=>row&&typeof row.id==='string'&&states.has(row.state))).map(row=>({
    id:row.id.slice(0,200),...safeFields(row),updatedAt:String(row.updatedAt||'').slice(0,40),
    // Corrupt local history must not crash Portfolio or imply a successful launch.
    state:Array.isArray(row.events)?row.state:'unknown',
    events:Array.isArray(row.events)?retainEvents(row.events.filter(event=>event&&states.has(event.state)))
      .map(event=>({...safeFields(event),at:String(event.at||'').slice(0,40)})):[],
  }));
}
export function readLaunchJournal(storage = globalThis.localStorage) {
  try {
    return publicRows(JSON.parse(storage.getItem(JOURNAL_KEY)||'[]'));
  } catch {return [];}
}
function safeFields(event){return Object.fromEntries(fields.filter(k=>event[k]!=null).map(k=>[k,typeof event[k]==='number'?event[k]:String(event[k]).slice(0,600)]));}
export function recordLaunchEvent(id, event, storage = globalThis.localStorage) {
  if(typeof id!=='string'||!id||id.length>200)throw new Error('A valid launch recovery identifier is required.');
  if(!states.has(event.state))throw new Error('Unknown launch journal state.');
  // Tolerant reads are useful for Portfolio display, but must never turn a
  // failed/corrupt recovery read into an empty ledger before a new broadcast.
  let rows;
  try{
    const raw=JSON.parse(storage.getItem(JOURNAL_KEY)||'[]');
    if(!Array.isArray(raw)||raw.some(row=>!row||typeof row.id!=='string'||!states.has(row.state)
      ||!Array.isArray(row.events)||row.events.some(item=>!item||!states.has(item.state))))throw Error('Invalid journal');
    rows=publicRows(raw);
  }catch{throw new Error('Launch recovery history could not be read. Preserve its receipts before starting another launch.');}
  const prior=rows.find(r=>r.id===id)||{id,events:[]};
  const safe=safeFields(event);
  const at=new Date().toISOString();const next={...prior,...safe,updatedAt:at,events:retainEvents([...(prior.events||[]),{...safe,at}])};
  try {
    const serialized=JSON.stringify(retainRows([...rows.filter(r=>r.id!==id),next]));
    storage.setItem(JOURNAL_KEY,serialized);
    if(storage.getItem(JOURNAL_KEY)!==serialized)throw Error('Journal write was not retained');
  }
  catch {throw new Error('Launch recovery could not be saved on this device. No further transaction will be sent.');}
  globalThis.dispatchEvent?.(new Event('funded:journal'));
  if (prior.state !== event.state && ['completed', 'failed'].includes(event.state)) productEvent(`launch_${event.state}`);
  return next;
}
export function journalRecovery(row) {
  const pending=pendingLaunchReceipts(row);
  if(pending.length)return `A transaction outcome is still uncertain. Check ${pending.map(event=>event.signature).join(', ')} before retrying; registration does not settle a pending developer buy.`;
  if(row.state==='completed')return 'Registered. Inspect the on-chain receipt.';
  if(row.events?.some(e=>e.step==='promotion-burn'&&e.state==='confirmed')&&!row.events?.some(e=>e.step==='launch'&&e.state==='confirmed'))return 'Promotion burn confirmed; coin creation is not confirmed. The burn cannot be reversed. Check all receipts before any retry; do not burn again.';
  if(['broadcasting','submitted','unknown'].includes(row.state))return 'Outcome uncertain. Check the recorded signature before starting another launch. Never assume a timeout means failure.';
  if(['confirmed','verification-pending','registration-pending'].includes(row.state))return 'A transaction confirmed. Verify the mint and finish registration; do not recreate the coin.';
  if(row.events?.some(e=>e.state==='confirmed'))return 'An earlier step confirmed. Router setup may remain on-chain. Inspect all receipts before starting again.';
  return 'No confirmed outcome recorded. Inspect any signature before starting again. Unsigned mint keys are not retained after reload.';
}
export function policyMatchesJournal(policy,row){return Boolean(policy&&row&&policy.mint===row.mint&&policy.cluster==='devnet'&&row.cluster==='devnet'&&policy.creatorWallet===row.payer&&(policy.signature||policy.pumpFeeRoute?.transaction)===row.signature);}
