import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStore} from '../server/store.mjs';
import {receiptRetentionOptions} from '../server/receipt-retention.mjs';

export async function verifyReceiptRetention(store,ageProofs=async()=>{}) {
  const old=new Date(Date.now()-60*86400000).toISOString(),fresh=new Date().toISOString(),before=new Date(Date.now()-30*86400000).toISOString();
  const entries=Array.from({length:5},(_,n)=>({key:(n+100).toString(16).padStart(64,'0'),verifiedAt:n<4?old:fresh,proof:{synthetic:true}}));
  const ledgerBefore=await store.read();await store.writeReceiptProofs(entries);await ageProofs(entries.slice(0,4).map(entry=>entry.key),old);
  const preview=await store.pruneReceiptProofs({before,limit:2});assert.equal(preview.mode,'dry-run');assert.equal(preview.selected,2);assert.equal(preview.removed,0);assert.equal(preview.hasMore,true);
  assert.equal((await store.readReceiptProofs(entries.map(entry=>entry.key))).length,5);
  const applied=await store.pruneReceiptProofs({before,limit:2,apply:true});assert.equal(applied.removed,2);assert.equal(applied.ledgerRecordsRemoved,0);
  assert.equal((await store.readReceiptProofs(entries.map(entry=>entry.key))).length,3);
  await store.pruneReceiptProofs({before,limit:2,apply:true});assert.equal((await store.readReceiptProofs(entries.map(entry=>entry.key))).length,1);
  assert.equal((await store.readReceiptProofs([entries[4].key])).length,1,'Fresh proofs are retained.');
  const ledgerAfter=await store.read();delete ledgerBefore.receiptProofs;delete ledgerAfter.receiptProofs;assert.deepEqual(ledgerAfter,ledgerBefore,'Retention cannot change financial, session or creator records.');
  for(const input of [{before:fresh},{before:'invalid'},{before,limit:501},{before,apply:'true'}])await assert.rejects(store.pruneReceiptProofs(input));
  assert.throws(()=>receiptRetentionOptions({}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const dir=await mkdtemp(join(tmpdir(),'funded-retention-'));try{await verifyReceiptRetention(createStore(join(dir,'state.json'),''));console.log('Receipt retention: explicit age/batch guards, dry-run, bounded apply, fresh-proof preservation and unchanged ledger passed (synthetic cache only).');}finally{await rm(dir,{recursive:true,force:true});}}
