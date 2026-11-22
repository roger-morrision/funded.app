import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {Keypair,VersionedTransaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {createTokenConversionTransport} from '../../server/token-conversion-transport.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';

const bucket='tokenConversionPriceJournalV1';
async function fixture(t,{category=5,send='land',signTimeoutMs=30000}={}){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-conversion-transport-')),path=join(dir,'ledger.json');
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const f=sellReviewFixture({category}),store=createAutomaticRewardStore(path),calls={price:0,operator:0,send:0},events=[];
  const hash=createHash('sha256').update(f.unsigned.message.serialize()).digest('hex');
  const row=async()=>Object.values((await store.read())[bucket].attempts)[0];
  const priceKey=Keypair.fromSeed(new Uint8Array(32).fill(34)),operatorKey=Keypair.fromSeed(new Uint8Array(32).fill(33));
  const priceSigner={publicKey:priceKey.publicKey,signMessage:async({message,messageHash,transactionBase64,role})=>{
    calls.price++;events.push('price');assert.equal(messageHash,hash);assert.equal(role,'price-attestation');
    assert.equal(transactionBase64,(await row()).unsignedTransaction);assert((await row()).signingStartedAt);
    assert.equal((await row()).status,'reserved');return nacl.sign.detached(message,priceKey.secretKey);
  }};
  const operator={publicKey:operatorKey.publicKey,signMessage:async({message,messageHash,role})=>{
    calls.operator++;events.push('operator');assert.equal(messageHash,hash);assert.equal(role,'operator');assert.equal(calls.price,1);
    return nacl.sign.detached(message,operatorKey.secretKey);
  }};
  const c={f,path,store,calls,events,hash,row,priceSigner,operator,wire:null};
  f.connection.sendRawTransaction=async(raw,options)=>{
    calls.send++;events.push('send');c.wire=Buffer.from(raw).toString('base64');const saved=await row();
    assert.equal(saved.status,'submitted');assert(saved.broadcastAttemptedAt);assert.equal(saved.signedTransaction,c.wire);
    assert.equal(options.maxRetries,0);assert.equal(options.skipPreflight,false);assert.equal(options.preflightCommitment,'finalized');
    if(send==='unknown')throw Error('Network response unavailable');
    if(send==='mismatch')return 'untrusted-provider-signature';
    f.advance();const signature=f.land(c.wire);f.advance();return signature;
  };
  c.make=(customStore=store)=>createTokenConversionTransport({store:customStore,connection:f.connection,config:f.config,release:f.release,
    priceSigner,operator,now:()=>f.now,signTimeoutMs});
  c.transport=c.make();await c.transport.initialize();return c;
}

for(const category of [5,6,7])test('transport durably reviews and saves both exact signatures before category '+category+' send',async t=>{
  const c=await fixture(t,{category}),r=await c.transport.run({request:c.f.request});assert.equal(r.status,'settled');
  assert.equal(r.proof.spentQuoteRaw,'1000000');assert.equal(r.proof.receivedLamports,'14211301');
  assert.deepEqual(c.events,['price','operator','send']);assert.equal(c.f.simulationCalls,2);
  const disk=await readFile(c.path,'utf8');assert.equal((await c.transport.run({messageHash:c.hash})).status,'settled');
  assert.equal(await readFile(c.path,'utf8'),disk);assert.deepEqual(c.calls,{price:1,operator:1,send:1});
});

test('transport unknown submission recovers exact original wire after restart without signing or sending again',async t=>{
  const c=await fixture(t,{send:'unknown'});assert.equal((await c.transport.run({request:c.f.request})).status,'reconciliation-pending');
  const restarted=c.make(createAutomaticRewardStore(c.path));await restarted.initialize();
  assert.equal((await restarted.run({request:c.f.request})).status,'reconciliation-pending');assert.deepEqual(c.calls,{price:1,operator:1,send:1});
  c.f.advance();c.f.land(c.wire);c.f.advance();assert.equal((await restarted.run({messageHash:c.hash,recoveryOnly:true})).status,'settled');
  assert.deepEqual(c.calls,{price:1,operator:1,send:1});
});

test('transport saved unsigned reservation is recovery-only after restart',async t=>{
  const c=await fixture(t);const {createTokenConversionJournal}=await import('../../server/token-conversion-journal.mjs');
  const journal=createTokenConversionJournal({store:c.store,connection:c.f.connection,config:c.f.config,release:c.f.release,now:()=>c.f.now});
  await journal.reserve(c.f.request);const disk=await readFile(c.path,'utf8');
  assert.equal((await c.make(createAutomaticRewardStore(c.path)).run({request:c.f.request})).status,'reconciliation-pending');
  assert.deepEqual(c.calls,{price:0,operator:0,send:0});assert.equal(await readFile(c.path,'utf8'),disk);
});

test('transport historical signed journal without a send marker is never automatically broadcast',async t=>{
  const c=await fixture(t);const {createTokenConversionJournal}=await import('../../server/token-conversion-journal.mjs');
  const journal=createTokenConversionJournal({store:c.store,connection:c.f.connection,config:c.f.config,release:c.f.release,now:()=>c.f.now});
  await journal.reserve(c.f.request);await journal.recordSigned({messageHash:c.hash,transactionBase64:c.f.sign()});const disk=await readFile(c.path,'utf8');
  assert.equal((await c.make(createAutomaticRewardStore(c.path)).run({request:c.f.request})).status,'reconciliation-pending');
  assert.deepEqual(c.calls,{price:0,operator:0,send:0});assert.equal(await readFile(c.path,'utf8'),disk);
});

test('transport absent recovery attempt cannot fall through to signing',async t=>{
  const c=await fixture(t);assert.equal((await c.transport.run({request:c.f.request,recoveryOnly:true})).status,'unavailable');
  assert.equal((await c.transport.run({messageHash:c.hash,recoveryOnly:true})).status,'unavailable');
  assert.deepEqual(c.calls,{price:0,operator:0,send:0});assert.equal(c.f.simulationCalls,0);
});

test('transport two store instances admit only one signing and broadcast owner',async t=>{
  const c=await fixture(t,{send:'unknown'}),second=c.make(createAutomaticRewardStore(c.path));await second.initialize();
  const results=await Promise.all([c.transport.run({request:c.f.request}),second.run({request:c.f.request})]);
  assert(results.every(r=>r.status==='reconciliation-pending'));assert.deepEqual(c.calls,{price:1,operator:1,send:1});
});

for(const stage of ['reserve','signing','signed','broadcast'])test('transport '+stage+' persistence failure suppresses dependent external action',async t=>{
  const c=await fixture(t),shouldFail=s=>{const a=Object.values(s[bucket].attempts)[0];return stage==='reserve'?!!a:stage==='signing'?!!a?.signingStartedAt:stage==='signed'?!!a?.signedTransaction:!!a?.broadcastAttemptedAt;};
  const failed={read:()=>c.store.read(),transaction:mutate=>c.store.transaction(s=>{const result=mutate(s);if(shouldFail(s))throw Error('Injected persistence failure');return result;})};
  await assert.rejects(c.make(failed).run({request:c.f.request}),/Injected persistence/);
  assert.equal(c.calls.send,0);if(['reserve','signing'].includes(stage))assert.equal(c.calls.price,0);
  const saved=Object.values((await c.store.read())[bucket].attempts);if(stage==='reserve')assert.equal(saved.length,0);
});

test('transport post-publication broadcast fence failure retains identity and forbids retry',async t=>{
  const c=await fixture(t),failed={read:()=>c.store.read(),transaction:async mutate=>{
    const result=await c.store.transaction(mutate);if((await c.row())?.broadcastAttemptedAt)throw Error('Published but unacknowledged');return result;
  }};
  await assert.rejects(c.make(failed).run({request:c.f.request}),/Published but unacknowledged/);
  assert.equal(c.calls.send,0);const before=await c.row();assert(before.signedTransaction&&before.broadcastAttemptedAt);
  const restarted=c.make(createAutomaticRewardStore(c.path));assert.equal((await restarted.run({messageHash:c.hash})).status,'reconciliation-pending');
  assert.deepEqual(await c.row(),before);assert.deepEqual(c.calls,{price:1,operator:1,send:0});
});

for(const role of ['priceSigner','operator'])test('transport invalid '+role+' signature never broadcasts',async t=>{
  const c=await fixture(t);c[role].signMessage=async()=>new Uint8Array(64);
  await assert.rejects(c.transport.run({request:c.f.request}),/signature differs/);assert.equal(c.calls.send,0);
  assert.equal((await c.row()).status,'reserved');
});

test('transport callback message mutation cannot redirect a signature',async t=>{
  const c=await fixture(t),key=Keypair.fromSeed(new Uint8Array(32).fill(34));
  c.priceSigner.signMessage=async({message})=>{message[0]^=1;return nacl.sign.detached(message,key.secretKey);};
  await assert.rejects(c.transport.run({request:c.f.request}),/signature differs/);assert.equal(c.calls.operator,0);assert.equal(c.calls.send,0);
});

test('transport expired price review prevents operator signing',async t=>{
  const c=await fixture(t),sign=c.priceSigner.signMessage;c.priceSigner.signMessage=async args=>{const sig=await sign(args);c.f.advance(35000,90);return sig;};
  assert.equal((await c.transport.run({request:c.f.request})).stage,'price-review-expired');assert.equal(c.calls.operator,0);assert.equal(c.calls.send,0);
});

test('transport expired operator review preserves signed bytes without broadcast',async t=>{
  const c=await fixture(t),sign=c.operator.signMessage;c.operator.signMessage=async args=>{const sig=await sign(args);c.f.advance(35000,90);return sig;};
  assert.equal((await c.transport.run({request:c.f.request})).stage,'signed-review-expired');assert((await c.row()).signedTransaction);assert.equal(c.calls.send,0);
});

test('transport timed-out signer keeps a durable unknown marker across restart',async t=>{
  const c=await fixture(t,{signTimeoutMs:10});c.priceSigner.signMessage=()=>{c.calls.price++;return new Promise(()=>{});};
  assert.equal((await c.transport.run({request:c.f.request})).stage,'price-signature-unconfirmed');
  assert.equal((await c.make(createAutomaticRewardStore(c.path)).run({request:c.f.request})).status,'reconciliation-pending');
  assert.deepEqual(c.calls,{price:1,operator:0,send:0});assert((await c.row()).signingStartedAt);
});

test('transport changed provider signature cannot mark completion',async t=>{
  const c=await fixture(t,{send:'mismatch'});assert.equal((await c.transport.run({request:c.f.request})).stage,'send-signature-mismatch');
  assert.equal((await c.row()).status,'submitted');assert.deepEqual(c.calls,{price:1,operator:1,send:1});
});

test('transport corrupt broadcast marker is rejected before any signer or send',async t=>{
  const c=await fixture(t,{send:'unknown'});await c.transport.run({request:c.f.request});
  const state=JSON.parse(await readFile(c.path,'utf8'));state[bucket].attempts[c.hash].broadcastAttemptedAt=state[bucket].clock+1;
  await writeFile(c.path,JSON.stringify(state));await assert.rejects(c.make(createAutomaticRewardStore(c.path)).status(),/broadcast marker/);
  assert.deepEqual(c.calls,{price:1,operator:1,send:1});
});

test('transport wrong signer identity is refused before journal initialization',async t=>{
  const c=await fixture(t);c.priceSigner.publicKey=c.operator.publicKey;assert.throws(()=>c.make(),/Distinct exact reviewed/);
  assert.equal(Object.keys((await c.store.read())[bucket].attempts).length,0);
});

test('transport delayed signing fence cannot expose a stale price request',async t=>{
  const c=await fixture(t),slow={read:()=>c.store.read(),transaction:async mutate=>{const result=await c.store.transaction(mutate);
    if((await c.row())?.signingStartedAt)c.f.advance(35000,90);return result;}};
  assert.equal((await c.make(slow).run({request:c.f.request})).stage,'signing-not-started');assert.deepEqual(c.calls,{price:0,operator:0,send:0});
});

test('transport delayed broadcast fence cannot send stale signed bytes',async t=>{
  const c=await fixture(t),slow={read:()=>c.store.read(),transaction:async mutate=>{const result=await c.store.transaction(mutate);
    if((await c.row())?.broadcastAttemptedAt)c.f.advance(35000,90);return result;}};
  assert.equal((await c.make(slow).run({request:c.f.request})).stage,'broadcast-not-started');assert.deepEqual(c.calls,{price:1,operator:1,send:0});
  assert((await c.row()).broadcastAttemptedAt);
});

test('transport actual second review catches changed operator solvency before send',async t=>{
  const c=await fixture(t),sign=c.operator.signMessage;c.operator.signMessage=async args=>{const signature=await sign(args);c.f.balance=0;return signature;};
  await assert.rejects(c.transport.run({request:c.f.request}));assert((await c.row()).signedTransaction);assert.equal((await c.row()).broadcastAttemptedAt,undefined);assert.equal(c.calls.send,0);
});

test('transport snapshots caller request before the first await',async t=>{
  const c=await fixture(t,{send:'unknown'}),running=c.transport.run({request:c.f.request});c.f.request.transaction='AA==';
  assert.equal((await running).status,'reconciliation-pending');assert.equal((await c.row()).messageHash,c.hash);assert.equal(c.calls.send,1);
});

test('transport unavailable operator never permits automatic signing replacement',async t=>{
  const c=await fixture(t);c.operator.signMessage=async()=>{c.calls.operator++;throw Error('Unknown signer outcome');};
  assert.equal((await c.transport.run({request:c.f.request})).stage,'operator-signature-unconfirmed');
  assert.equal((await c.make(createAutomaticRewardStore(c.path)).run({request:c.f.request})).status,'reconciliation-pending');
  assert.deepEqual(c.calls,{price:1,operator:1,send:0});
});

test('transport mutated signer handle is checked against the durable role',async t=>{
  const c=await fixture(t);c.priceSigner.publicKey=c.operator.publicKey;
  await assert.rejects(c.transport.run({request:c.f.request}),/identity changed/);assert.deepEqual(c.calls,{price:0,operator:0,send:0});
});
