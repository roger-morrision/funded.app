export const JOURNAL_KEY = 'funded.launch.journal.v1';
const states = new Set(['prepared','awaiting-approval','broadcasting','submitted','confirmed','verification-pending','registration-pending','completed','failed','cancelled','unknown']);
const fields = ['state','step','mint','signature','payer','cluster','name','symbol','message','lastValidBlockHeight'];
export function readLaunchJournal(storage = globalThis.localStorage) {
  try {
    const rows=JSON.parse(storage.getItem(JOURNAL_KEY)||'[]');
    if(!Array.isArray(rows))return [];
    return rows.filter(r=>r&&typeof r.id==='string'&&states.has(r.state)).slice(-50).map(row=>({
      id:row.id.slice(0,200),...safeFields(row),updatedAt:String(row.updatedAt||'').slice(0,40),
      // Corrupt local history must not crash Portfolio or imply a successful launch.
      state:Array.isArray(row.events)?row.state:'unknown',
      events:Array.isArray(row.events)?row.events.filter(e=>e&&states.has(e.state)).slice(-60).map(e=>({...safeFields(e),at:String(e.at||'').slice(0,40)})):[],
    }));
  } catch {return [];}
}
function safeFields(event){return Object.fromEntries(fields.filter(k=>event[k]!=null).map(k=>[k,typeof event[k]==='number'?event[k]:String(event[k]).slice(0,600)]));}
export function recordLaunchEvent(id, event, storage = globalThis.localStorage) {
  if(!states.has(event.state))throw new Error('Unknown launch journal state.');
  const rows=readLaunchJournal(storage), prior=rows.find(r=>r.id===id)||{id,events:[]};
  const safe=safeFields(event);
  const at=new Date().toISOString();const next={...prior,...safe,updatedAt:at,events:[...(prior.events||[]),{...safe,at}].slice(-60)};
  try {storage.setItem(JOURNAL_KEY,JSON.stringify([...rows.filter(r=>r.id!==id),next].slice(-50)));}
  catch {throw new Error('Launch recovery could not be saved on this device. No further transaction will be sent.');}
  globalThis.dispatchEvent?.(new Event('funded:journal'));
  return next;
}
export function journalRecovery(row) {
  if(row.state==='completed')return 'Registered. Inspect the on-chain receipt.';
  if(['broadcasting','submitted','unknown'].includes(row.state))return 'Outcome uncertain. Check the recorded signature before starting another launch. Never assume a timeout means failure.';
  if(['confirmed','verification-pending','registration-pending'].includes(row.state))return 'A transaction confirmed. Verify the mint and finish registration; do not recreate the coin.';
  if(row.events?.some(e=>e.state==='confirmed'))return 'An earlier step confirmed. Router setup may remain on-chain. Inspect all receipts before starting again.';
  return 'No confirmed outcome recorded. Inspect any signature before starting again. Unsigned mint keys are not retained after reload.';
}
export function policyMatchesJournal(policy,row){return Boolean(policy&&row&&policy.mint===row.mint&&policy.cluster==='devnet'&&row.cluster==='devnet'&&policy.creatorWallet===row.payer&&(policy.signature||policy.pumpFeeRoute?.transaction)===row.signature);}
