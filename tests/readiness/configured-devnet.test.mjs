import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {configuredFixture} from './configured-devnet-fixture.mjs';
import {decodeBuybackRequest,reviewBuyback} from '../../server/price-signer-review.mjs';
import {PriceSignerJournal} from '../../server/price-signer-journal.mjs';
import {loadFinalizedV3Buyback} from '../../server/v3-buyback-proof.mjs';
import {richAssetsAddress} from '../../rich-assets.js';

async function journal(t,f){
  const dir=await mkdtemp(join(tmpdir(),'configured-unsigned-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'reservations.jsonl'),store=new PriceSignerJournal(path,{interfaceContext:f.context});await store.load();return {store,path};
}

for(const revision of ['1','2'])test('unsigned configured revision '+revision+' crosses builder reviewer journal and historical proof parser',async t=>{
  const f=configuredFixture(t,{revision}),args=decodeBuybackRequest(f.current.built.instruction.data);
  assert.equal(f.current.built.instruction.data.length,72);assert.equal(args.assetsRevision,revision);
  const review=await reviewBuyback(f.reviewArgs());assert.equal(review.contextHash,f.context.contextHash);assert.equal(review.assetsRevision,revision);assert.equal(review.signingAllowed,false);
  const {store,path}=await journal(t,f);await store.reserve(review,{connection:f.connection,maxDailyLamports:'30000',now:f.now});
  const saved=await readFile(path,'utf8'),restart=new PriceSignerJournal(path,{interfaceContext:f.context});await restart.load();
  await restart.reserve(review,{connection:f.connection,maxDailyLamports:'30000',now:f.now});assert.equal(await readFile(path,'utf8'),saved);
  f.finalized=true;f.activeRevision='2';const proof=await loadFinalizedV3Buyback(f.proofArgs());
  assert.ok(proof,'real proof parser accepts the synthetic finalized transaction and immutable history');
  assert.equal(proof.contextHash,f.context.contextHash);assert.equal(proof.assetsRevision,revision);
  assert.equal(proof.spentLamports,'10000');assert.equal(proof.burnedBaseUnits,'20000');
  assert.equal(proof.fundedMint,String(f.current.assets.mint));
  assert.ok(f.current.transaction.signatures.every(signature=>signature.every(byte=>byte===0)));
});

test('configured agency wire retains 130 bytes and exact revision/config metas for both asset revisions',t=>{
  const f=configuredFixture(t);
  for(const revision of ['1','2']){
    const {built}=f.build(revision,{agency:true}),args=decodeBuybackRequest(built.instruction.data);
    assert.equal(built.instruction.data.length,130);assert.equal(args.agency,true);assert.equal(args.configured,true);assert.equal(args.assetsRevision,revision);
    assert.equal(built.instruction.keys[3].isWritable,false,'Devnet does not acquire Mainnet guard semantics');
    const last=built.instruction.keys.at(-1);assert.ok(last.pubkey.equals(richAssetsAddress(f.context.programId)));assert.equal(last.isSigner,false);assert.equal(last.isWritable,false);
  }
});

test('ordinary service request fields cannot enable the offline configured interface',async t=>{
  const f=configuredFixture(t);
  await assert.rejects(reviewBuyback({...f.reviewArgs(),configuredDevnet:null,request:{...f.current.request,configuredDevnet:f.context}}),/admitted release/);
  // This program now has explicit live runtime admission. Omitting the offline
  // context cannot downgrade its wire ABI to the old hardcoded-token variant.
  const runtime=f.build('1',{contextOverride:null});assert.equal(runtime.built.instruction.data.length,72);
});

for(const field of ['genesisHash','programId','programDataSha256','elfSha256','contractSourceTree','sourceRevision'])test('changed immutable interface context is rejected: '+field,async t=>{
  const f=configuredFixture(t),context={...f.context,[field]:'changed'};
  await assert.rejects(reviewBuyback({...f.reviewArgs(),configuredDevnet:context}));assert.equal(f.quoteCalls,0);
});

test('Mainnet cannot be selected with the offline Devnet context',async t=>{
  const f=configuredFixture(t);
  await assert.rejects(reviewBuyback({...f.reviewArgs(),config:{...f.config,cluster:'mainnet-beta'},request:{...f.current.request,cluster:'mainnet-beta'}}));
  assert.equal(f.quoteCalls,0);
});

test('wrong RPC genesis rejects unsigned review and finalized proof',async t=>{
  const f=configuredFixture(t);f.connection.getGenesisHash=async()=> 'wrong-network';
  await assert.rejects(reviewBuyback(f.reviewArgs()),/network/);assert.equal(await loadFinalizedV3Buyback(f.proofArgs()),null);
});

test('a changed ProgramData deployment rejects unsigned review and proof',async t=>{
  const f=configuredFixture(t),account=f.connection.getAccountInfo;
  f.connection.getAccountInfo=async(address,...rest)=>{
    const value=await account(address,...rest);
    if(String(address)!==f.context.programDataAddress)return value;
    const data=Buffer.from(value.data);data[4]^=1;data[data.length-1]^=1;return {...value,data};
  };
  f.connection.getMultipleAccountsInfo=async addresses=>Promise.all(addresses.map(a=>f.connection.getAccountInfo(a)));
  await assert.rejects(reviewBuyback(f.reviewArgs()),/Deployed program/);assert.equal(await loadFinalizedV3Buyback(f.proofArgs()),null);
});

test('stale asset revision cannot obtain a new review after rotation',async t=>{
  const f=configuredFixture(t,{revision:'1'});f.activeRevision='2';
  await assert.rejects(reviewBuyback(f.reviewArgs()),/configuration changed/);assert.equal(f.quoteCalls,0);
});

test('wrong config account and writable router metadata are rejected',async t=>{
  const f=configuredFixture(t);
  f.current=f.build('2',{mutate:ix=>{ix.keys.at(-1).pubkey=new PublicKey(new Uint8Array(32).fill(88));}});
  await assert.rejects(reviewBuyback(f.reviewArgs()),/configuration changed/);
  f.current=f.build('2',{mutate:ix=>{ix.keys[3].isWritable=true;}});
  await assert.rejects(reviewBuyback(f.reviewArgs()),/Noncanonical/);
});

test('nonzero signatures and an underprotected quote are rejected',async t=>{
  const f=configuredFixture(t);f.current.transaction.signatures[0][0]=1;
  f.current.request.transaction=Buffer.from(f.current.transaction.serialize()).toString('base64');
  await assert.rejects(reviewBuyback(f.reviewArgs()),/Only unsigned/);
  f.current=f.build('2',{mutate:ix=>ix.data.writeBigUInt64LE(1n,48)});
  await assert.rejects(reviewBuyback(f.reviewArgs()),/output protection/);
});

test('an existing receipt prevents a fresh review and cannot be replayed into signing',async t=>{
  const f=configuredFixture(t);f.finalized=true;
  await assert.rejects(reviewBuyback(f.reviewArgs()),/replay rejected/);
});

test('missing receipt or wrong vault delta cannot produce finalized credit proof',async t=>{
  const f=configuredFixture(t);assert.equal(await loadFinalizedV3Buyback(f.proofArgs()),null);
  f.finalized=true;const original=f.connection.getTransaction;
  f.connection.getTransaction=async()=>{const tx=await original();tx.meta.postBalances=[...tx.meta.preBalances];return tx;};
  assert.equal(await loadFinalizedV3Buyback(f.proofArgs()),null);
});

test('offline reservations reject legacy records and changed context/revision without rewriting them',async t=>{
  const f=configuredFixture(t),review=await reviewBuyback(f.reviewArgs()),{store,path}=await journal(t,f);
  await store.reserve(review,{connection:f.connection,maxDailyLamports:'30000',now:f.now});const saved=await readFile(path,'utf8');
  await assert.rejects(store.reserve({...review,contextHash:'0'.repeat(64)},{connection:f.connection,maxDailyLamports:'30000',now:f.now}),/context differs/);
  await assert.rejects(store.reserve({...review,assetsRevision:'1'},{connection:f.connection,maxDailyLamports:'30000',now:f.now}),/revision differs/);
  assert.equal(await readFile(path,'utf8'),saved);
  const legacy=JSON.parse(saved);delete legacy.contextHash;delete legacy.assetsRevision;await writeFile(path,JSON.stringify(legacy)+'\n');
  const bytes=await readFile(path,'utf8');await assert.rejects(new PriceSignerJournal(path,{interfaceContext:f.context}).load(),/explicit migration/);assert.equal(await readFile(path,'utf8'),bytes);
});

test('unknown reservations stay charged until finalized expiry and absent-receipt evidence',async t=>{
  const f=configuredFixture(t),review=await reviewBuyback(f.reviewArgs()),{store,path}=await journal(t,f);
  await store.reserve(review,{connection:f.connection,maxDailyLamports:'30000',now:f.now});const saved=await readFile(path,'utf8'),next={...review,messageHash:'f'.repeat(64)};
  await assert.rejects(store.reserve(next,{connection:f.connection,maxDailyLamports:'30000',now:f.now}),/lacks finalized/);assert.equal(await readFile(path,'utf8'),saved);
  f.connection.isBlockhashValid=async()=>({context:{slot:f.slot+1},value:false});
  f.connection.getAccountInfoAndContext=async()=>{throw Error('archive unavailable');};
  await assert.rejects(store.reserve(next,{connection:f.connection,maxDailyLamports:'30000',now:f.now}),/lacks finalized/);assert.equal(await readFile(path,'utf8'),saved);
  f.connection.getAccountInfoAndContext=async()=>({context:{slot:f.slot+2},value:null});
  await store.reserve(next,{connection:f.connection,maxDailyLamports:'30000',now:f.now});assert.equal(store.entries.filter(row=>row.type==='release').length,1);
});
