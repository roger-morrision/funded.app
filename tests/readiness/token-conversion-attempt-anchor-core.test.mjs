import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildAttemptAnchorProvisioningMarker,createTokenConversionAttemptAnchorCore}
  from '../../server/token-conversion-attempt-anchor-core.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const context={genesisHash:'synthetic-mainnet-genesis',programId:'synthetic-program',
  programDataSha256:'a'.repeat(64),policyHash:'b'.repeat(64),controller:'controller-public',
  operator:'operator-public',priceAttestor:'price-public',sourceRevision:'c'.repeat(40)};
const message=Buffer.from('immutable synthetic unsigned message');
const messageHash=sha(message),unsignedMessageBase64=message.toString('base64');
const preparedPayload={unsignedMessageBase64,reviewDigest:'e'.repeat(64),conversionId:'synthetic-nonce',
  vault:'synthetic-vault',receipt:'synthetic-receipt',amountInRaw:'1000000',minOutputLamports:'14000000'};
const signatureBase64=Buffer.alloc(64,7).toString('base64');
const signedWire=Buffer.from('synthetic signed wire, not a real Solana transaction');
const signedWireBase64=signedWire.toString('base64'),signedWireSha256=sha(signedWire);
const signedPayload={signedWireBase64,signedWireSha256,
  operatorSignatureBase64:signatureBase64,priceSignatureBase64:signatureBase64};

class ImmutableMemoryStore {
  constructor(id){this.id=id;this.entries=new Map();this.failNext=false;this.failAfterWrite=false;}
  async listImmutable(){return [...this.entries].sort(([a],[b])=>a.localeCompare(b))
    .map(([key,bytes])=>({key,bytes,versions:1}));}
  async putIfAbsent(key,bytes){
    if(this.failNext){this.failNext=false;throw Error(`${this.id} publication unavailable`);}
    const existing=this.entries.get(key);
    if(existing!==undefined)throw Error('Conditional immutable key already exists.');
    this.entries.set(key,bytes);
    if(this.failAfterWrite){this.failAfterWrite=false;throw Error(`${this.id} acknowledgment unavailable`);}
    return true;
  }
}
async function fixture({provision=true}={}){
  const primary=new ImmutableMemoryStore('primary'),secondary=new ImmutableMemoryStore('secondary');
  if(provision){
    const marker=buildAttemptAnchorProvisioningMarker({context,reviewDigest:'d'.repeat(64)});
    await primary.putIfAbsent(marker.key,marker.bytes);await secondary.putIfAbsent(marker.key,marker.bytes);
  }
  return {primary,secondary,anchor:createTokenConversionAttemptAnchorCore({primary,secondary,context})};
}
const prepared=anchor=>anchor.append({stage:'prepared',messageHash,payload:preparedPayload});
const role=(anchor,stage)=>anchor.append({stage,messageHash,payload:{signatureBase64}});
const facts=({broadcast=true,proof=true}={})=>({controller:{[messageHash]:{
  prepared:preparedPayload,'signed-wire':signedPayload,
  ...(broadcast?{'broadcast-intent':{signedWireSha256}}:{}),
  ...(proof?{'finalized-proof':{proofBase64:Buffer.from('exact synthetic proof').toString('base64'),
    proofSha256:sha(Buffer.from('exact synthetic proof'))}}:{})}},
  operator:{[messageHash]:{'operator-signature':{signatureBase64}}},
  price:{[messageHash]:{'price-signature':{signatureBase64}}}});

test('dual publication binds one prepared message, both roles, wire, intent and proof',async()=>{
  const {anchor}=await fixture();
  await prepared(anchor);await role(anchor,'price-signature');await role(anchor,'operator-signature');
  await anchor.append({stage:'signed-wire',messageHash,payload:signedPayload});
  await anchor.append({stage:'broadcast-intent',messageHash,payload:{signedWireSha256}});
  const proof=Buffer.from('exact synthetic proof');
  await anchor.append({stage:'finalized-proof',messageHash,payload:{proofBase64:proof.toString('base64'),proofSha256:sha(proof)}});
  assert.deepEqual(await anchor.verifyJournalSet(facts()),{contextHash:anchor.contextHash,
    highWater:6,attempts:1,journalSetMatchesAnchor:true});
  await assert.rejects(prepared(anchor),/already has an anchored attempt/);
  await assert.rejects(role(anchor,'operator-signature'),/stage lacks one immutable|Finished anchored/);
});

test('partial dual write is unresolved and cannot authorize another event',async()=>{
  const {primary,secondary,anchor}=await fixture();secondary.failNext=true;
  let signingCallbacks=0;
  await assert.rejects(async()=>{await prepared(anchor);signingCallbacks++;},/publication unavailable/);
  assert.equal(signingCallbacks,0);assert.equal(primary.entries.size,2);assert.equal(secondary.entries.size,1);
  await assert.rejects(anchor.load(),/histories differ/);
  await assert.rejects(prepared(anchor),/histories differ/);
  assert.equal(signingCallbacks,0);
});

test('post-publication uncertainty retains the exact entry without authorizing a new attempt',async()=>{
  const {primary,secondary,anchor}=await fixture();secondary.failAfterWrite=true;
  await assert.rejects(prepared(anchor),/acknowledgment unavailable/);
  assert.equal(primary.entries.size,2);assert.equal(secondary.entries.size,2);
  assert.equal((await anchor.load())[1].messageHash,messageHash);
  await assert.rejects(prepared(anchor),/already has an anchored attempt/);
  await assert.rejects(anchor.verifyJournalSet({controller:{},operator:{},price:{}}),
    /missing from a role journal/);
});

test('coherent rollback of all three journals is detected from the retained anchor',async()=>{
  const {anchor}=await fixture();await prepared(anchor);
  await role(anchor,'price-signature');await role(anchor,'operator-signature');
  await anchor.append({stage:'signed-wire',messageHash,payload:signedPayload});
  await assert.rejects(anchor.verifyJournalSet({controller:{},operator:{},price:{}}),/missing from a role journal/);
  const rolledBack=facts({broadcast:false,proof:false});delete rolledBack.controller[messageHash]['signed-wire'];
  await assert.rejects(anchor.verifyJournalSet(rolledBack),/signed-wire missing/);
  const restored=facts({broadcast:false,proof:false});
  assert.equal((await anchor.verifyJournalSet(restored)).highWater,4);
});

test('journal intent changes and role stages ahead of the anchor refuse recovery',async()=>{
  const {anchor}=await fixture();await prepared(anchor);
  const matching={controller:{[messageHash]:{prepared:preparedPayload}},operator:{},price:{}};
  assert.equal((await anchor.verifyJournalSet(matching)).highWater,1);
  matching.controller[messageHash].prepared={...preparedPayload,amountInRaw:'1000001'};
  await assert.rejects(anchor.verifyJournalSet(matching),/prepared differs/);
  matching.controller[messageHash].prepared=preparedPayload;
  matching.price[messageHash]={'price-signature':{signatureBase64}};
  await assert.rejects(anchor.verifyJournalSet(matching),/unanchored stage/);
});

test('older, deleted, extra-version and corrupt copies fail closed',async()=>{
  const {primary,secondary,anchor}=await fixture();await prepared(anchor);
  secondary.entries.delete('000000000001');
  await assert.rejects(anchor.load(),/histories differ/);
  secondary.entries.set('000000000001',primary.entries.get('000000000001'));
  const list=secondary.listImmutable.bind(secondary);
  secondary.listImmutable=async()=>{const entries=await list();entries[1].deleted=true;return entries;};
  await assert.rejects(anchor.load(),/Complete immutable anchor inventory/);
  secondary.listImmutable=async()=>{const entries=await list();entries[1].versions=2;return entries;};
  await assert.rejects(anchor.load(),/Complete immutable anchor inventory/);
  secondary.listImmutable=list;
  secondary.entries.set('000000000001',secondary.entries.get('000000000001').replace('prepared','tampered'));
  await assert.rejects(anchor.load(),/digest differs/);
});

test('fresh work requires an explicit matching provisioning marker and context',async()=>{
  const {primary,secondary,anchor}=await fixture({provision:false});
  await assert.rejects(prepared(anchor),/Explicitly provisioned anchor/);
  const marker=buildAttemptAnchorProvisioningMarker({context,reviewDigest:'d'.repeat(64)});
  await primary.putIfAbsent(marker.key,marker.bytes);await secondary.putIfAbsent(marker.key,marker.bytes);
  const wrong=createTokenConversionAttemptAnchorCore({primary,secondary,context:{...context,programId:'other-program'}});
  await assert.rejects(wrong.load(),/release context differs/);
  await prepared(anchor);assert.equal((await anchor.load()).length,2);
});

test('same-sequence competing writers cannot both anchor different messages',async()=>{
  const {primary,secondary}=await fixture();
  const a=createTokenConversionAttemptAnchorCore({primary,secondary,context});
  const b=createTokenConversionAttemptAnchorCore({primary,secondary,context});
  const other=Buffer.from('different unsigned message'),otherHash=sha(other);
  const results=await Promise.allSettled([prepared(a),b.append({stage:'prepared',messageHash:otherHash,
    payload:{...preparedPayload,unsignedMessageBase64:other.toString('base64')}})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.equal((await a.load()).length,2);
});

test('unsigned, unanchored or already-final attempts cannot advance',async()=>{
  const {anchor}=await fixture();
  await assert.rejects(role(anchor,'price-signature'),/lacks one immutable prepared attempt/);
  await assert.rejects(anchor.append({stage:'prepared',messageHash,payload:{...preparedPayload,unsignedMessageBase64:'YQ=='}}),
    /Prepared message hash differs/);
  await assert.rejects(anchor.append({stage:'prepared',messageHash,
    payload:{...preparedPayload,privateKey:'must never be published'}}),/Only reviewed public anchor payload fields/);
  await assert.rejects(anchor.append({stage:'prepared',messageHash,
    payload:{...preparedPayload,conversionId:'x'.repeat(33000)}}),/Bounded anchor entry/);
  await prepared(anchor);
  await assert.rejects(anchor.append({stage:'signed-wire',messageHash,payload:signedPayload}),
    /Both role signatures/);
  const absent=Buffer.from('finalized synthetic absence');
  await assert.rejects(anchor.append({stage:'finalized-absence',messageHash,
    payload:{absenceBase64:absent.toString('base64'),absenceSha256:sha(absent)}}),/broadcast intent/);
  await role(anchor,'price-signature');await role(anchor,'operator-signature');
  await assert.rejects(anchor.append({stage:'signed-wire',messageHash,payload:{...signedPayload,
    priceSignatureBase64:Buffer.alloc(64,8).toString('base64')}}),/bind both previously anchored/);
  await anchor.append({stage:'signed-wire',messageHash,payload:signedPayload});
  await anchor.append({stage:'broadcast-intent',messageHash,payload:{signedWireSha256}});
  await anchor.append({stage:'finalized-absence',messageHash,payload:{absenceBase64:absent.toString('base64'),absenceSha256:sha(absent)}});
  await assert.rejects(role(anchor,'price-signature'),/Finished anchored attempts/);
});
