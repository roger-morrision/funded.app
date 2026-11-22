import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadFinalizedTokenSell} from '../../server/token-conversion-sell-proof.mjs';
import {sellProofFixture} from './token-sell-proof-fixture.mjs';
import {finalizedProgramContext} from '../../server/finalized-program-context.mjs';

function deployment(f,slot){f.programData.data.writeBigUInt64LE(slot,4);f.release.programDataSha256=createHash('sha256').update(f.programData.data).digest('hex');}

test('reviewed deployment effective before tx authenticates with fresh finalized context and no account cache',async()=>{
  const f=sellProofFixture();deployment(f,999n);
  const proof=await loadFinalizedTokenSell(f.adapterArgs());assert.ok(proof);assert.equal(proof.deploymentSlot,'999');
  assert.equal(proof.programContextSlot,1001);assert.equal(proof.programDataContextSlot,1001);assert.equal(proof.receiptContextSlot,1001);
  assert.deepEqual(f.contextReads.map(r=>r.minimum),[1000,1001]);
  await loadFinalizedTokenSell(f.adapterArgs());assert.equal(f.contextReads.length,4,'Every authentication performs uncached contextual reads');
});

test('a later or same-slot reviewed deployment cannot authenticate the older signed transaction',async()=>{
  for(const slot of [1000n,1001n,1100n]){
    const f=sellProofFixture();deployment(f,slot);f.programContextSlot=1200;f.programDataContextSlot=1200;f.receiptContextSlot=1200;
    assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
  }
});

test('stale, backwards and malformed finalized program contexts remain unresolved',async()=>{
  for(const [field,value]of [['programContextSlot',999],['programDataContextSlot',999],['programContextSlot',undefined],
    ['programDataContextSlot','1001'],['programContextSlot',1000.5],['programDataContextSlot',Number.MAX_SAFE_INTEGER+1]]){
    const f=sellProofFixture();f[field]=value;assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
  }
  const f=sellProofFixture();f.programContextSlot=1002;f.programDataContextSlot=1001;assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
});

test('missing contextual RPC, malformed deployment header and stale receipt or status context cannot fall back to cached bytes',async()=>{
  for(const mutate of [f=>{delete f.connection.getAccountInfoAndContext;},f=>{f.programData.data=Buffer.alloc(44);},
    f=>{f.receiptContextSlot=1000;},f=>{f.statusContextSlot=999;},f=>{f.statusContextSlot=undefined;},
    f=>{f.connection.getAccountInfoAndContext=async()=>{throw Error('context unavailable');};}]){
    const f=sellProofFixture();mutate(f);assert.equal(await loadFinalizedTokenSell(f.adapterArgs()),null);
  }
});

test('later absence checks retain the original deployment interval and require the requested fresh context floor',async()=>{
  const f=sellProofFixture();f.programContextSlot=1200;f.programDataContextSlot=1201;
  const args={connection:f.connection,release:f.release,transactionSlot:1000,minimumContextSlot:1200};
  assert.equal((await finalizedProgramContext(args)).programDataContextSlot,1201);
  assert.deepEqual(f.contextReads.map(r=>r.minimum),[1200,1200]);
  for(const floor of [999,undefined,NaN,'1200',Infinity]){
    if(floor===undefined)continue;
    await assert.rejects(finalizedProgramContext({...args,minimumContextSlot:floor}));
  }
  f.programContextSlot=1199;await assert.rejects(finalizedProgramContext(args),/stale/);
  f.programContextSlot=1200;deployment(f,1100n);
  await assert.rejects(finalizedProgramContext(args),/predates/);
});
