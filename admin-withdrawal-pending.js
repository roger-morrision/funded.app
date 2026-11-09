const KEY='funded.admin.pending-withdrawals.v2';
const LEGACY='funded.admin.pending-withdrawal.devnet.v1';
export const withdrawalSignature=value=>/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
const scope=(cluster,destination,source)=>JSON.stringify([cluster,destination,source]);
const valid=row=>row&&withdrawalSignature(row.signature)&&Number.isSafeInteger(row.lastValidBlockHeight)
  &&typeof row.destination==='string'&&!!row.destination&&typeof row.source==='string'&&!!row.source;

export function createPendingWithdrawals(storage,cluster='devnet') {
  let rows={};
  try {const saved=JSON.parse(storage.getItem(KEY));if(saved&&typeof saved==='object'&&!Array.isArray(saved))rows=saved;} catch {}
  // Migrate only public receipt identity. Leave the old record intact if storage
  // cannot persist the replacement; never discard an unresolved transaction.
  try {
    const old=JSON.parse(storage.getItem(LEGACY));
    if(valid(old)) {
      const key=scope('devnet',old.destination,old.source);
      if(!valid(rows[key])||rows[key].signature===old.signature){
        rows[key]=old;storage.setItem(KEY,JSON.stringify(rows));storage.removeItem(LEGACY);
      }
    }
  } catch {}
  return {
    get(destination,source) {const row=rows[scope(cluster,destination,source)];return valid(row)?row:null;},
    save(row) {
      if(!valid(row))throw Error('Withdrawal recovery identity is incomplete.');
      const saved=Object.fromEntries(['signature','intentId','source','destination','feePayer','amountLamports','lastValidBlockHeight']
        .filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
      const next={...rows,[scope(cluster,row.destination,row.source)]:saved};
      storage.setItem(KEY,JSON.stringify(next));rows=next;return saved;
    },
    clear(row) {
      const key=scope(cluster,row.destination,row.source);
      if(rows[key]?.signature!==row.signature)return;
      const next={...rows};delete next[key];storage.setItem(KEY,JSON.stringify(next));rows=next;
      // Also handle an earlier migration that could not remove its legacy copy.
      try {if(JSON.parse(storage.getItem(LEGACY))?.signature===row.signature)storage.removeItem(LEGACY);} catch {}
    }
  };
}
