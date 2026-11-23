import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Offline consistency core only. Each independently administered backend must
// implement listImmutable() as a complete ordered inventory of current entries,
// versions and delete markers, and putIfAbsent() as a durable create returning
// true only when a new immutable key was created. A store ID is not custody proof.
// The caller must map its authenticated journals to {messageHash:{stage:payload}};
// this module does not verify RPC finality, transaction signatures or approval.
// No production worker, signer, HTTP service or credential resolver imports it.
const ZERO='0'.repeat(64),HEX=/^[a-f0-9]{64}$/;
const stages=new Set(['prepared','price-signature','operator-signature','signed-wire',
  'broadcast-intent','finalized-proof','finalized-absence']);
const payloadFields={
  prepared:['unsignedMessageBase64','reviewDigest','conversionId','vault','receipt','amountInRaw','minOutputLamports'],
  'price-signature':['signatureBase64'],
  'operator-signature':['signatureBase64'],
  'signed-wire':['signedWireBase64','signedWireSha256','operatorSignatureBase64','priceSignatureBase64'],
  'broadcast-intent':['signedWireSha256'],
  'finalized-proof':['proofBase64','proofSha256'],
  'finalized-absence':['absenceBase64','absenceSha256'],
};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.getPrototypeOf(value)===Object.prototype;
const canonical=value=>{
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  assert(object(value),'Anchor entries must be canonical JSON values.');
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rawBytes=(value,name)=>{
  assert(typeof value==='string'&&value.length>0,`${name} bytes required.`);
  const bytes=Buffer.from(value,'base64');
  assert(bytes.length>0&&bytes.toString('base64')===value,`${name} must use canonical base64.`);
  return bytes;
};
const key=sequence=>String(sequence).padStart(12,'0');
const encode=body=>canonical({...body,digest:sha(canonical(body))});
const decode=(text,expectedKey)=>{
  assert(typeof text==='string'&&text.length<=32768,'Bounded anchor entry required.');
  const event=JSON.parse(text);
  assert(object(event)&&canonical(event)===text&&Number.isSafeInteger(event.sequence)
    &&event.sequence>=0&&key(event.sequence)===expectedKey&&HEX.test(event.digest),
  'Noncanonical or misplaced anchor entry.');
  const {digest,...body}=event;
  assert(sha(canonical(body))===digest,'Anchor entry digest differs.');
  return event;
};
const validateContext=context=>{
  assert(object(context),'Reviewed public release context required.');
  for(const name of ['genesisHash','programId','programDataSha256','policyHash',
    'controller','operator','priceAttestor','sourceRevision'])
    assert(typeof context[name]==='string'&&context[name].length>0,`${name} required.`);
  for(const name of ['programDataSha256','policyHash'])assert(HEX.test(context[name]),`${name} digest required.`);
  return structuredClone(context);
};
const stagePayload=(stage,hash,payload,prior)=>{
  assert(object(payload),'Typed anchor payload required.');
  assert.deepEqual(Object.keys(payload).sort(),[...payloadFields[stage]].sort(),
    'Only reviewed public anchor payload fields are permitted.');
  if(stage==='prepared'){
    assert(sha(rawBytes(payload.unsignedMessageBase64,'Unsigned message'))===hash,
      'Prepared message hash differs.');
    assert(HEX.test(payload.reviewDigest)&&typeof payload.conversionId==='string'&&payload.conversionId.length>0
      &&typeof payload.vault==='string'&&payload.vault.length>0
      &&typeof payload.receipt==='string'&&payload.receipt.length>0
      &&/^[1-9]\d*$/.test(payload.amountInRaw)
      &&/^[1-9]\d*$/.test(payload.minOutputLamports),
    'Prepared attempt needs immutable review, nonce, custody and amount facts.');
    assert(!prior.length,'The same message already has an anchored attempt.');
  }else{
    assert(!prior.some(event=>['finalized-proof','finalized-absence'].includes(event.stage)),
      'Finished anchored attempts cannot advance.');
    assert(prior[0]?.stage==='prepared'&&!prior.some(event=>event.stage===stage),
      'Anchor stage lacks one immutable prepared attempt.');
  }
  if(stage==='price-signature'||stage==='operator-signature')
    assert(rawBytes(payload.signatureBase64,'Role signature').length===64,'64-byte role signature required.');
  if(stage==='signed-wire'){
    const price=prior.find(event=>event.stage==='price-signature');
    const operator=prior.find(event=>event.stage==='operator-signature');
    assert(price&&operator,'Both role signatures must be anchored first.');
    assert(payload.priceSignatureBase64===price.payload.signatureBase64
      &&payload.operatorSignatureBase64===operator.payload.signatureBase64,
    'Signed wire must bind both previously anchored role signatures.');
    assert(sha(rawBytes(payload.signedWireBase64,'Signed wire'))===payload.signedWireSha256,
      'Signed wire digest differs.');
  }
  if(stage==='broadcast-intent'){
    const signed=prior.find(event=>event.stage==='signed-wire');
    assert(signed&&payload.signedWireSha256===signed.payload.signedWireSha256,
      'Broadcast intent must bind the anchored signed wire.');
  }
  if(stage==='finalized-proof'){
    assert(prior.some(event=>event.stage==='broadcast-intent'),'Finalized transaction needs broadcast intent.');
    assert(sha(rawBytes(payload.proofBase64,'Finalized proof'))===payload.proofSha256,
      'Finalized proof digest differs.');
  }
  if(stage==='finalized-absence'){
    assert(prior.some(event=>event.stage==='broadcast-intent'),'Finalized absence needs broadcast intent.');
    assert(sha(rawBytes(payload.absenceBase64,'Finalized absence'))===payload.absenceSha256,
      'Finalized absence digest differs.');
  }
};
const validateEvents=(entries,contextHash)=>{
  assert(Array.isArray(entries)&&entries.length>0,'Explicitly provisioned anchor required.');
  const events=[];let prior=ZERO;
  for(const [index,entry]of entries.entries()){
    assert(object(entry)&&entry.key===key(index)&&typeof entry.bytes==='string'
      &&entry.deleted!==true&&entry.versions===1,'Complete immutable anchor inventory required.');
    const event=decode(entry.bytes,entry.key);
    assert(event.version===1&&event.sequence===index&&event.priorDigest===prior&&event.contextHash===contextHash,
      'Anchor sequence, predecessor or release context differs.');
    if(index===0){
      assert(event.stage==='provision'&&event.messageHash===null&&object(event.payload)
        &&HEX.test(event.payload.reviewDigest),'Reviewed provisioning marker required.');
    }else{
      assert(stages.has(event.stage)&&HEX.test(event.messageHash),'Typed anchored attempt required.');
      stagePayload(event.stage,event.messageHash,event.payload,
        events.filter(previous=>previous.messageHash===event.messageHash));
    }
    events.push(event);prior=event.digest;
  }
  return events;
};

export function buildAttemptAnchorProvisioningMarker({context,reviewDigest}){
  const contextHash=sha(canonical(validateContext(context)));
  assert(HEX.test(reviewDigest),'Reviewed first-provisioning digest required.');
  return {key:key(0),bytes:encode({version:1,sequence:0,priorDigest:ZERO,contextHash,
    messageHash:null,stage:'provision',payload:{reviewDigest}})};
}

export function createTokenConversionAttemptAnchorCore({primary,secondary,context}){
  assert(primary!==secondary&&primary?.id&&secondary?.id&&primary.id!==secondary.id,
    'Two distinct immutable store references required.');
  for(const store of [primary,secondary])assert(typeof store.listImmutable==='function'
    &&typeof store.putIfAbsent==='function','Conditional immutable store interface required.');
  const contextHash=sha(canonical(validateContext(context)));
  const load=async()=>{
    const [first,second]=await Promise.all([primary.listImmutable(),secondary.listImmutable()]);
    const a=validateEvents(first,contextHash),b=validateEvents(second,contextHash);
    assert(a.length===b.length&&a.every((event,i)=>canonical(event)===canonical(b[i])),
      'Independent anchor histories differ; reconciliation required.');
    return a;
  };
  return {contextHash,load,
    async append({stage,messageHash,payload}){
      assert(stages.has(stage)&&HEX.test(messageHash),'Typed message hash and anchor stage required.');
      const before=await load(),same=before.filter(event=>event.messageHash===messageHash);
      stagePayload(stage,messageHash,payload,same);
      const body={version:1,sequence:before.length,priorDigest:before.at(-1).digest,
        contextHash,messageHash,stage,payload:structuredClone(payload)};
      const entry={key:key(body.sequence),bytes:encode(body)};
      assert(entry.bytes.length<=32768,'Bounded anchor entry required.');
      // A partial acknowledgment is deliberately not retried as fresh work.
      // An independent read must agree before the caller can observe success.
      assert(await primary.putIfAbsent(entry.key,entry.bytes)===true,
        'Primary immutable conditional write was not newly created.');
      assert(await secondary.putIfAbsent(entry.key,entry.bytes)===true,
        'Secondary immutable conditional write was not newly created.');
      const after=await load();
      assert(after.length===before.length+1&&after.at(-1).digest===sha(canonical(body)),
        'Anchor publication was not independently observed.');
      return structuredClone(after.at(-1));
    },
    async verifyJournalSet({controller,operator,price}){
      for(const [name,rows]of Object.entries({controller,operator,price}))
        assert(object(rows),`${name} journal attempt facts required.`);
      const events=await load(),attempts=new Map();
      for(const event of events.slice(1)){
        const hash=event.messageHash,record=attempts.get(hash)||{};
        const facts=event.stage==='price-signature'?price[hash]
          :event.stage==='operator-signature'?operator[hash]:controller[hash];
        assert(object(facts)&&object(facts[event.stage]),
          `Anchored ${event.stage} missing from a role journal.`);
        assert.deepEqual(facts[event.stage],event.payload,
          `Anchored ${event.stage} differs from a role journal.`);
        record[event.stage]=true;attempts.set(hash,record);
      }
      for(const [name,rows]of Object.entries({controller,operator,price}))for(const [hash,facts]of Object.entries(rows)){
        assert(attempts.has(hash)&&object(facts),'Role journal is ahead of the immutable anchor.');
        for(const stage of Object.keys(facts))assert(attempts.get(hash)[stage]
          &&(name==='controller'?stage!=='price-signature'&&stage!=='operator-signature'
            :stage===`${name}-signature`),
          'Role journal has an unanchored stage.');
      }
      return {contextHash,highWater:events.length-1,attempts:attempts.size,
        journalSetMatchesAnchor:true};
    }};
}
