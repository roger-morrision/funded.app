import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createStore } from '../server/store.mjs';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { runReceiptBackfill,receiptBackfillPage } from '../server/receipt-backfill.mjs';
import { receiptHistoryFixture } from './fixtures/receipt-history-data.mjs';

// Call only against a disposable test store; replaces synthetic receipt buckets.
export async function verifyBackfillStore(store,other=store) {
  const fixture=receiptHistoryFixture();await store.update(s=>Object.assign(s,fixture.state));
  let calls=0;
  const reader=createReceiptEvidenceReader({store,cluster:'devnet',commitment:'finalized',officialGenesis:async()=>'fixture',connectionFactory:()=>({getGenesisHash:async()=>'fixture',getTransaction:async signature=>{calls++;return fixture.transactions.get(signature);}})});
  const run=(maxPages=1)=>runReceiptBackfill({store,readEvidence:reader,maxPages});
  const first=await run();assert.equal(first.status,'batch-finished');assert.equal(first.progress.checked,12);
  assert.equal((await other.readReceiptBackfillStatus('devnet')).lastRun.status,'batch-finished');
  const checkpoint=await other.acquireReceiptBackfill('devnet','observe',120000);assert.equal(checkpoint.after,first.progress.after);await other.releaseReceiptBackfill('devnet','observe');
  assert.deepEqual(await other.readReceiptBackfillPage('devnet',checkpoint),receiptBackfillPage(await store.read(),'devnet',checkpoint));
  const result=await run(100);assert.equal(result.status,'pass-finished');assert.deepEqual([result.progress.lastPass.checked,result.progress.lastPass.verified,result.progress.lastPass.unresolved],[58,58,0]);
  const count=calls;await run(100);assert.equal(calls,count,'Second pass reuses finalized proofs.');
  assert.ok(await store.acquireReceiptBackfill('devnet','held',120000));assert.equal((await run()).status,'busy');
  assert.equal(await other.checkpointReceiptBackfill('devnet','wrong',{},120000),false);await store.releaseReceiptBackfill('devnet','held');
  assert.equal(await other.recordReceiptBackfillOutcome('devnet','wrong',{status:'failed'}),false);
  await store.acquireReceiptBackfill('devnet','expired',-1);assert.ok(await other.acquireReceiptBackfill('devnet','replacement',120000));
  assert.equal(await store.checkpointReceiptBackfill('devnet','expired',{},120000),false);await store.releaseReceiptBackfill('devnet','expired');
  assert.equal(await store.acquireReceiptBackfill('devnet','third',120000),null);await other.releaseReceiptBackfill('devnet','replacement');
  const before=await store.acquireReceiptBackfill('devnet','before',120000);await store.releaseReceiptBackfill('devnet','before');
  const blocked=await runReceiptBackfill({store,readEvidence:async()=>({commitment:'finalized',status:'unavailable'})});assert.equal(blocked.status,'blocked');
  assert.equal((await other.readReceiptBackfillStatus('devnet')).lastRun.status,'blocked');
  const after=await store.acquireReceiptBackfill('devnet','after',120000);assert.deepEqual(after,before);await store.releaseReceiptBackfill('devnet','after');
  const storage=await runReceiptBackfill({store,readEvidence:async()=>({commitment:'finalized',status:'onchain-indexed',indexStorage:'unavailable'})});assert.equal(storage.status,'blocked');
  await assert.rejects(runReceiptBackfill({store,readEvidence:async()=>{throw new Error('private-rpc-key');}}));
  const failed=await other.readReceiptBackfillStatus('devnet');assert.equal(failed.lastRun.status,'failed');assert.doesNotMatch(JSON.stringify(failed),/private-rpc-key/);assert.equal(failed.owner,null);
  await assert.rejects(runReceiptBackfill({store,readEvidence:reader,cluster:'mainnet-beta'}));
  await assert.rejects(runReceiptBackfill({store,readEvidence:reader,maxPages:0}));
  const abort=new AbortController();abort.abort();await assert.rejects(runReceiptBackfill({store,readEvidence:reader,signal:abort.signal}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const dir=await mkdtemp(join(tmpdir(),'funded-backfill-'));try{await verifyBackfillStore(createStore(join(dir,'state.json'),''));console.log('Receipt backfill: bounded resume, 58 mocked finalized receipts, repeated passes, durable reuse, lease fencing, unavailable-storage/RPC blocking and Devnet/abort guards passed.');}finally{await rm(dir,{recursive:true,force:true});}}
