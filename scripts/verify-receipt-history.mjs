import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createStore } from '../server/store.mjs';
import { creatorReceiptPage,decodeReceiptCursor,receiptFingerprint } from '../server/receipt-history.mjs';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { buildCreatorSupport,createCreatorSupportHandler } from '../server/creator-support.mjs';
import { receiptHistoryFixture } from './fixtures/receipt-history-data.mjs';

const fixture=receiptHistoryFixture(),dir=await mkdtemp(join(tmpdir(),'funded-history-'));let server;
try {
  const path=join(dir,'state.json'),store=createStore(path,'');await store.update(s=>Object.assign(s,fixture.state));
  let calls=0;
  const options={store,cluster:'devnet',commitment:'finalized',officialGenesis:async()=>'devnet-fixture',connectionFactory:()=>({getGenesisHash:async()=>'devnet-fixture',getTransaction:async(signature,config)=>{assert.equal(config.commitment,'finalized');calls++;return fixture.transactions.get(signature);}})};
  const reader=createReceiptEvidenceReader(options),signatures=new Set();let cursor='',pages=0;
  do {
    const page=await store.readCreatorReceiptPage(fixture.id,'devnet',decodeReceiptCursor(cursor));
    assert.deepEqual(page,creatorReceiptPage(fixture.state,fixture.id,'devnet',decodeReceiptCursor(cursor)));
    const evidence=await reader(page.state),creator=buildCreatorSupport(page.state,fixture.id,evidence,'devnet');
    assert.ok(creator.receipts.length<=12);
    for(const receipt of creator.receipts){assert.ok(!signatures.has(receipt.signature));signatures.add(receipt.signature);}
    cursor=page.nextCursor;pages++;
  }while(cursor);
  assert.equal(pages,3);assert.equal(signatures.size,29);assert.equal(calls,58);
  const restarted=createStore(path,'');
  const cached=createReceiptEvidenceReader({...options,store:restarted,connectionFactory:()=>{throw new Error('Indexed proof should survive restart without RPC');}});
  const first=await restarted.readCreatorReceiptPage('123','devnet');
  assert.equal((await cached(first.state)).indexedRecords,24);
  assert.equal(receiptFingerprint('payouts',{a:1,b:{c:2,d:3}}),receiptFingerprint('payouts',{b:{d:3,c:2},a:1}),'JSONB key ordering must not change fingerprints.');
  const altered=structuredClone(first.state);altered.payouts['history-000'].amountLamports=800001;
  const changed=await reader(altered);assert.equal(changed.verifiedPayouts.length,11);assert.equal(changed.status,'partial');
  for(const value of ['***','Zg=','AA','a'.repeat(600)])assert.throws(()=>decodeReceiptCursor(value));
  assert.equal((await store.readCreatorReceiptPage('456','devnet')).checkedPayouts,0);
  assert.equal((await store.readCreatorReceiptPage('123','mainnet-beta')).checkedPayouts,0);

  let optOutDuringRead=false,editDuringRead=false;
  const historyReader=async state=>{const evidence=await reader(state);if(optOutDuringRead)await store.updateCreatorProfile('123',s=>{s.creatorProfiles['123'].optedOut=true;});if(editDuringRead)await store.update(s=>{s.payouts['history-000'].amountLamports=1;});return evidence;};
  const handler=createCreatorSupportHandler({store,cluster:'devnet',getSession:async()=>null,readEvidence:reader,readFinalizedEvidence:historyReader,capabilities:async()=>({})});
  server=createServer(async(req,res)=>{try{if(!await handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}}catch(error){res.writeHead(500);res.end(error.message);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${base}/api/creators/123/receipts`);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.receipts.length,12);assert.equal(body.commitment,'finalized');assert.ok(body.nextCursor);
  const second=await(await fetch(`${base}/api/creators/123/receipts?after=${body.nextCursor}`)).json();assert.equal(second.receipts.length,12);assert.notEqual(second.receipts[0].signature,body.receipts[0].signature);
  assert.equal((await fetch(`${base}/api/creators/123/receipts?after=***`)).status,400);
  editDuringRead=true;assert.equal((await fetch(`${base}/api/creators/123/receipts`)).status,503,'Changed records during proof reads must not reuse earlier evidence.');editDuringRead=false;
  optOutDuringRead=true;
  assert.equal((await fetch(`${base}/api/creators/123/receipts`)).status,404,'Opt-out during a proof read must not leak a successful page.');
  assert.equal((await fetch(`${base}/api/creators/123/receipts`)).status,404,'Opt-out applies even with persisted proofs.');
  console.log('Finalized history: 29 synthetic payouts across 3 pages, exact entitlement joins, persisted proof reuse across restart, payload invalidation, cursor/identity/cluster guards and HTTP privacy passed (mocked RPC).');
}finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(dir,{recursive:true,force:true});}
