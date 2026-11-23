import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {createTokenConversionJournal} from '../../server/token-conversion-journal.mjs';
import {tokenPricePolicyHash} from '../../server/token-conversion-sell-review.mjs';
import {sellReviewFixture} from './token-sell-review-fixture.mjs';

const bucket='tokenConversionPriceJournalV1';
async function setup(t,f=sellReviewFixture(),path=null){
  if(!path){
    const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-typed-journal-'));
    t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert.ok(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
    path=join(dir,'reservations.json');
  }
  const store=createAutomaticRewardStore(path),journal=createTokenConversionJournal({store,connection:f.connection,config:f.config,release:f.release,now:()=>f.now});
  await journal.initialize(path&&await store.hasPublishedFile()?undefined:{firstProvisioningRole:'controller'});return {f,path,store,journal};
}
function policy(f,order,daily){f.config.quotePolicy.maxOrderQuoteRaw=order;f.config.quotePolicy.maxDailyQuoteRaw=daily;
  f.release.priceSignerPolicy=structuredClone(f.config);f.release.independentReview.priceSignerPolicySha256=tokenPricePolicyHash(f.config);}

for(const category of [5,6,7])test('durable actual review reserves signs and reconciles category '+category+' then permits the next nonce',async t=>{
  const {f,journal,path}=await setup(t,sellReviewFixture({category,prefund:700000}));
  const first=await journal.reserve(f.request);assert.equal(first.reservation.status,'reserved');
  const disk=JSON.parse(await readFile(path,'utf8'));assert.equal(disk[bucket].attempts[first.review.messageHash].amountIn,'1000000');
  const signed=f.sign(),saved=await journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:signed});assert.equal(saved.status,'submitted');
  assert.equal((await journal.reconcile({messageHash:first.review.messageHash})).status,'reconciliation-pending');
  f.advance();f.land(signed);f.advance();const settled=await journal.reconcile({messageHash:first.review.messageHash});
  assert.equal(settled.status,'settled');assert.equal(settled.proof.spentQuoteRaw,'1000000');assert.equal(settled.proof.receivedLamports,'14211301');
  const prior=JSON.stringify(settled);assert.equal(JSON.stringify(await journal.reconcile({messageHash:first.review.messageHash})),prior);
  f.nextNonce(80);const next=await journal.reserve(f.request);assert.equal(next.reservation.status,'reserved');
  assert.notEqual(next.review.messageHash,first.review.messageHash);assert.equal(Object.keys((await journal.status()).attempts).length,2);
});

test('same reviewed message is idempotent before and after durable store restart',async t=>{
  const a=await setup(t),first=await a.journal.reserve(a.f.request),saved=JSON.stringify(first.reservation);
  assert.equal(JSON.stringify((await a.journal.reserve(a.f.request)).reservation),saved);
  const restart=await setup(t,a.f,a.path);assert.equal(JSON.stringify((await restart.journal.reserve(a.f.request)).reservation),saved);
  assert.equal(Object.keys((await restart.journal.status()).attempts).length,1);
});

test('unknown old attempts block replacement even outside the rolling budget window',async t=>{
  const {f,journal}=await setup(t);await journal.reserve(f.request);f.nextNonce(81);f.advance(86400001,216001);
  await assert.rejects(journal.reserve(f.request),/unresolved/);assert.equal(Object.keys((await journal.status()).attempts).length,1);
});

test('two locked store instances cannot race past the typed USDC daily bound',async t=>{
  const f=sellReviewFixture({category:5}),g=sellReviewFixture({category:6});policy(f,'1000000','1500000');policy(g,'1000000','1500000');
  const a=await setup(t,f),b=await setup(t,g,a.path);
  const outcomes=await Promise.allSettled([a.journal.reserve(f.request),b.journal.reserve(g.request)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
  const attempts=Object.values((await a.journal.status()).attempts);assert.equal(attempts.length,1);assert.equal(attempts[0].amountIn,'1000000');
});

test('only both valid signatures on the exact durable message can be recorded for submission',async t=>{
  const {f,journal}=await setup(t),first=await journal.reserve(f.request);
  await assert.rejects(journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:f.request.transaction}),/signatures/);
  const signed=f.sign(),tx=VersionedTransaction.deserialize(Buffer.from(signed,'base64'));tx.message.recentBlockhash=String(PublicKey.default);
  await assert.rejects(journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:Buffer.from(tx.serialize()).toString('base64')}),/differs/);
  const saved=await journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:signed});
  assert.equal(JSON.stringify(await journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:signed})),JSON.stringify(saved));
});

test('finalized expiry plus absent receipt releases only raw conversion budget and permits a fresh blockhash',async t=>{
  const {f,journal}=await setup(t),first=await journal.reserve(f.request);f.advance();f.blockhashValid=false;
  const released=await journal.reconcile({messageHash:first.review.messageHash});assert.equal(released.status,'released-no-conversion');
  assert.equal(released.release.kind,'finalized-expired-and-absent');assert.match(released.release.feeOutcome,/may have paid fees/);
  await assert.rejects(journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:f.sign()}),/No active/);
  f.recentBlockhash=String(new PublicKey(new Uint8Array(32).fill(92)));f.blockhashValid=true;f.rebuild();
  const next=await journal.reserve(f.request);assert.equal(next.reservation.status,'reserved');assert.notEqual(next.review.messageHash,first.review.messageHash);
});

test('stale program context, unavailable receipt and a live blockhash preserve reservations',async t=>{
  const {f,journal,path}=await setup(t),first=await journal.reserve(f.request),before=await readFile(path,'utf8');
  assert.equal((await journal.reconcile({messageHash:first.review.messageHash})).status,'reconciliation-pending');assert.equal(await readFile(path,'utf8'),before);
  f.advance();f.blockhashValid=false;f.programDataContextSlot-=1;
  assert.equal((await journal.reconcile({messageHash:first.review.messageHash})).status,'reconciliation-pending');assert.equal(await readFile(path,'utf8'),before);
  f.programDataContextSlot=f.market.slot;const read=f.connection.getAccountInfoAndContext;
  f.connection.getAccountInfoAndContext=async(address,...rest)=>String(address)===first.reservation.receipt?Promise.reject(Error('archive unavailable')):read(address,...rest);
  assert.equal((await journal.reconcile({messageHash:first.review.messageHash})).status,'reconciliation-pending');assert.equal(await readFile(path,'utf8'),before);
});

test('a finalized status without the exact transaction proof cannot clear or release the reservation',async t=>{
  const {f,journal}=await setup(t),first=await journal.reserve(f.request),signed=f.sign(),row=await journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:signed});
  f.advance();f.blockhashValid=false;f.connection.getSignatureStatuses=async()=>({context:{slot:f.market.slot},value:[{slot:f.market.slot,err:null,confirmationStatus:'finalized'}]});
  assert.equal((await journal.reconcile({messageHash:first.review.messageHash})).status,'reconciliation-pending');
  assert.equal((await journal.status()).attempts[row.messageHash].status,'submitted');
});

test('an externally recovered signature cannot bypass unresolved finalized transaction evidence',async t=>{
  const {f,journal,path}=await setup(t),first=await journal.reserve(f.request),before=await readFile(path,'utf8');
  f.advance();f.blockhashValid=false;
  f.connection.getSignatureStatuses=async()=>({context:{slot:f.market.slot},value:[{slot:f.market.slot,err:null,confirmationStatus:'finalized'}]});
  assert.equal((await journal.reconcile({messageHash:first.review.messageHash,signature:'recovered-public-signature'})).status,'reconciliation-pending');
  assert.equal(await readFile(path,'utf8'),before);
});

test('a finalized failed attempt releases conversion budget without claiming a fee refund',async t=>{
  const {f,journal}=await setup(t),first=await journal.reserve(f.request);
  await journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:f.sign()});
  f.advance();f.blockhashValid=false;
  f.connection.getSignatureStatuses=async()=>({context:{slot:f.market.slot},value:[{slot:f.market.slot,err:{InstructionError:[0,'Custom']},confirmationStatus:'finalized'}]});
  const result=await journal.reconcile({messageHash:first.review.messageHash});
  assert.equal(result.status,'released-no-conversion');assert.equal(result.release.signatureOutcome,'failed-finalized');
  assert.match(result.release.feeOutcome,/may have paid fees/);
});

test('clock rollback cannot mutate a signed reservation or authorize a replacement',async t=>{
  const {f,journal,path}=await setup(t),first=await journal.reserve(f.request),before=await readFile(path,'utf8');
  f.now-=1;await assert.rejects(journal.recordSigned({messageHash:first.review.messageHash,transactionBase64:f.sign()}),/clock moved backwards/);
  assert.equal(await readFile(path,'utf8'),before);
});

test('a review delayed before the durable write cannot reserve stale signing intent',async t=>{
  const {f,store,path}=await setup(t),before=await readFile(path,'utf8');
  const delayed={read:()=>store.read(),transaction:mutate=>{f.advance(35000,90);return store.transaction(mutate);}};
  const journal=createTokenConversionJournal({store:delayed,connection:f.connection,config:f.config,release:f.release,now:()=>f.now});
  await assert.rejects(journal.reserve(f.request),/review expired before/);assert.equal(await readFile(path,'utf8'),before);
});

test('legacy context, corrupt reservation and array-shaped attempt storage are rejected without rewriting disk',async t=>{
  for(const mutate of [state=>{state[bucket]=null;},state=>{state[bucket].attempts=[];},state=>{state[bucket].context.quoteMint=String(PublicKey.default);},
    state=>{Object.values(state[bucket].attempts)[0].receipt=String(PublicKey.default);},state=>{Object.values(state[bucket].attempts)[0].unsignedTransaction='AA==';}]){
    const a=await setup(t);await a.journal.reserve(a.f.request);const state=JSON.parse(await readFile(a.path,'utf8'));mutate(state);await writeFile(a.path,JSON.stringify(state));
    const before=await readFile(a.path,'utf8');const journal=createTokenConversionJournal({store:createAutomaticRewardStore(a.path),connection:a.f.connection,config:a.f.config,release:a.f.release,now:()=>a.f.now});
    await assert.rejects(journal.initialize());assert.equal(await readFile(a.path,'utf8'),before);
  }
});

test('no independent policy admission or legacy budget denomination can create a production journal',()=>{
  const f=sellReviewFixture();assert.throws(()=>createTokenConversionJournal({store:{read(){},transaction(){}},connection:f.connection,config:f.config}),/production/);
  f.config.quotePolicy.quoteMint=String(PublicKey.default);assert.throws(()=>createTokenConversionJournal({store:{read(){},transaction(){}},connection:f.connection,config:f.config,release:f.release}));
});
