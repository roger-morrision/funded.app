import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction} from '@solana/web3.js';
import {DEFAULT_AGENCY_RULES,validateAgencyRules} from '../config/agency-rules.js';
import {encodeAgencyRules,decodeAgencyRules} from '../agency-rules-v3.js';
import {agencyCategoryTargets,agencyProtocolUnits,agencyProtocolSplit,buildAgencyRulesV3Instruction} from '../agency-mint-router-v3.js';
import {prepareAgencyRules} from '../server/admin-agency-policy.mjs';
import {verifyPreparedAgencyRules} from '../agency-rules-review.js';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
const rules={marketCapUsd:[10,20],communityWindowSeconds:300,promotionIntervalSeconds:172800};
test('legacy settings stay unchanged, extended settings roundtrip, malformed settings fail closed',()=>{
  assert.deepEqual(decodeAgencyRules(Buffer.alloc(383),383),{...DEFAULT_AGENCY_RULES,source:'legacy-defaults'});
  const bytes=Buffer.concat([Buffer.alloc(383),encodeAgencyRules(rules)]);
  assert.deepEqual(validateAgencyRules(decodeAgencyRules(bytes,383)),rules);
  for(const mutate of [b=>b[383]^=1,b=>b.writeBigUInt64LE(1n,391),b=>b.writeBigInt64LE(1n,415)]){
    const corrupt=Buffer.from(bytes);mutate(corrupt);assert.throws(()=>decodeAgencyRules(corrupt,383));
  }
  assert.throws(()=>decodeAgencyRules(bytes.subarray(0,422),383));
  for(const bad of [{...rules,marketCapUsd:[20,10]},{...rules,communityWindowSeconds:299},{...rules,promotionIntervalSeconds:86399}])
    assert.throws(()=>validateAgencyRules(bad));
});
test('agency share can change inside the fixed protocol 20%, preserving exact cumulative totals',()=>{
  const units=agencyProtocolUnits();units[0]-=100000;units[6]+=100000;
  assert.equal(agencyProtocolSplit(units).agencyPercent,15);
  for(const total of ['1','49','1000001','18446744073709551615'])assert.equal(agencyCategoryTargets(total,units).reduce((a,b)=>a+b,0n),BigInt(total));
  assert.equal(agencyCategoryTargets('10000000',units)[0],8000000n);
  assert.throws(()=>agencyCategoryTargets('100',units.map((n,i)=>i===6?n+1:n)));
});
test('admin preparation is unsigned, revision-bound, has one authority signer, and never sends a transaction',async()=>{
  const programId=key(91),authority=key(92),promotionRecipient=key(93),protocolUnits=agencyProtocolUnits();let sends=0;
  const input={expectedRevision:'7',rules,split:agencyProtocolSplit(),promotionRecipient:String(promotionRecipient)};
  const args={programId,authority,input,approvedHash:'a'.repeat(64),connection:{
    getLatestBlockhash:async()=>({blockhash:String(key(94)),lastValidBlockHeight:500}),sendRawTransaction:()=>{sends++;}},
    readDeployment:async()=>({verified:true,revision:'7'})};
  const prepared=await prepareAgencyRules(args),tx=Transaction.from(Buffer.from(prepared.transaction,'base64'));
  assert.equal(sends,0);assert.equal(tx.signatures.length,1);assert.equal(tx.signatures[0].signature,null);
  assert(tx.instructions[0].data.equals(buildAgencyRulesV3Instruction({programId,authority,protocolUnits,promotionRecipient,expectedRevision:'7',rules}).instruction.data));
  assert.equal(tx.instructions[0].data.length,108);assert.equal(prepared.publishingPaused,true);
  const review={programId,authority,split:input.split,rules,promotionRecipient,expectedRevision:'7'};
  assert(verifyPreparedAgencyRules(prepared,review));
  for(const changed of [{...review,rules:{...rules,communityWindowSeconds:600}},
    {...review,promotionRecipient:key(95)},{...review,expectedRevision:'8'}])
    assert.throws(()=>verifyPreparedAgencyRules(prepared,changed),/differs/);
  const altered=Transaction.from(Buffer.from(prepared.transaction,'base64'));
  altered.instructions[0].data[8]^=1;
  assert.throws(()=>verifyPreparedAgencyRules({...prepared,transaction:altered.serialize({requireAllSignatures:false}).toString('base64')},review),/differs/);
  await assert.rejects(prepareAgencyRules({...args,input:{...input,expectedRevision:'6'}}),/changed/);
});
