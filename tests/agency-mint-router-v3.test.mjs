import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import {AGENCY_V3_DISCRIMINATORS,agencyCategoryTargets,agencyAgentTargets,agencyProtocolUnits,
  deriveAgencyPolicyV3,deriveAgencyConfigV3,deriveAgencyVaultsV3,decodeAgencyConfigV3,decodeAgencyPolicyV3,
  buildAgencyMintV3InitializeInstruction,buildAgencyMintV3SettlementInstruction,buildAgencyMintV3DisbursementInstruction,
  buildAgencyPromotionV3Instruction,buildAgencyConfigV3Instruction} from '../agency-mint-router-v3.js';
const [program,mint,creator,authority,billing]=[130,131,132,133,134].map(n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey);
const shares={creatorWalletPercent:60,holderAirdropPercent:10,solClaimPercent:10};
const input={programId:program,mint,creator,authority},policyInput={programId:program,mint,creator,initialAuthority:authority,
  shares,protocolUnits:agencyProtocolUnits(),selectedAgents:['x-promotion','buyback-100k','buyback-300k']};
function account(){
  const data=Buffer.alloc(383);Buffer.from(AGENCY_V3_DISCRIMINATORS.MintAgencyPolicyV3,'hex').copy(data);
  mint.toBuffer().copy(data,8);creator.toBuffer().copy(data,40);authority.toBuffer().copy(data,72);
  agencyProtocolUnits().forEach((n,i)=>data.writeUInt32LE(n,104+i*4));data.writeBigUInt64LE(1000000000n,132);
  agencyCategoryTargets('1000000000').forEach((n,i)=>data.writeBigUInt64LE(n,140+i*8));
  [6000000,1000000,1000000].forEach((n,i)=>data.writeUInt32LE(n,268+i*4));data[304]=7;
  billing.toBuffer().copy(data,342);data.writeBigUInt64LE(1n,374);data[382]=deriveAgencyPolicyV3(program,mint).bump;
  return{owner:program,data,executable:false};
}
test('browser discriminators match Anchor and eight-category cumulative targets preserve every unit',()=>{
  for(const[name,hex]of Object.entries(AGENCY_V3_DISCRIMINATORS))assert.equal(createHash('sha256')
    .update(`${/^[A-Z]/.test(name)?'account':'global'}:${name}`).digest().subarray(0,8).toString('hex'),hex);
  for(const amount of ['0','1','2','49','50','99','1000002','18446744073709551615']){
    assert.equal(agencyCategoryTargets(amount).reduce((sum,n)=>sum+n,0n),BigInt(amount));
    for(let mask=1;mask<8;mask++)assert.equal(agencyAgentTargets(amount,mask).reduce((sum,n)=>sum+n,0n),BigInt(amount));
  }
  assert.deepEqual(agencyAgentTargets('10',5),[5n,0n,5n]);assert.deepEqual(agencyAgentTargets('10',0),[0n,0n,0n]);
  for(const bad of ['01','-1',Number.MAX_SAFE_INTEGER+1,'18446744073709551616'])assert.throws(()=>agencyCategoryTargets(bad));
  const bad=agencyProtocolUnits();bad[6]=0;assert.throws(()=>agencyCategoryTargets('100',bad));
});
test('agency decoder binds immutable identity, rates, selections and all protected counters',()=>{
  const good=account(),decoded=decodeAgencyPolicyV3(good,policyInput);assert.equal(decoded.verified,true);assert.equal(decoded.agencyPolicy,true);
  assert.equal(decoded.paidLamports[7],20000000n);assert.equal(decoded.paidLamports[6],50000000n);
  assert.deepEqual(decoded.agentTargets,[6666666n,6666667n,6666667n]);
  const corrupt=[data=>data[0]^=1,data=>data[304]=8,data=>data[329]=1,data=>data.writeBigUInt64LE(1n,280),
    data=>data.writeBigUInt64LE(20000001n,260),data=>data.writeBigUInt64LE(6666667n,305),data=>data.writeBigUInt64LE(1n,330),
    data=>data[374]=0,data=>data[104]^=1,data=>data[268]^=1];
  for(const edit of corrupt){const next=account();edit(next.data);assert.throws(()=>decodeAgencyPolicyV3(next,policyInput));}
  assert.throws(()=>decodeAgencyPolicyV3({...good,owner:creator},policyInput));
  assert.throws(()=>decodeAgencyPolicyV3({...good,data:good.data.subarray(0,293)},policyInput));
  assert.throws(()=>decodeAgencyPolicyV3(good,{...policyInput,selectedAgents:[]}));
  assert.throws(()=>decodeAgencyPolicyV3(good,{...policyInput,creator:authority}));
});
test('future configuration decoder and instructions bind current revision and nonzero billing address',()=>{
  const data=Buffer.alloc(77);Buffer.from(AGENCY_V3_DISCRIMINATORS.AgencyConfigV3,'hex').copy(data);
  agencyProtocolUnits().forEach((n,i)=>data.writeUInt32LE(n,8+i*4));billing.toBuffer().copy(data,36);data.writeBigUInt64LE(1n,68);data[76]=deriveAgencyConfigV3(program).bump;
  const row=decodeAgencyConfigV3({owner:program,data},program);assert.equal(row.revision,'1');assert.equal(row.promotionRecipient,billing.toBase58());
  const created=buildAgencyConfigV3Instruction({programId:program,authority,promotionRecipient:billing});assert.equal(created.instruction.data.length,68);
  const changed=buildAgencyConfigV3Instruction({programId:program,authority,promotionRecipient:billing,expectedRevision:'1'});assert.equal(changed.instruction.data.readBigUInt64LE(68),1n);
  assert.throws(()=>buildAgencyConfigV3Instruction({programId:program,authority,promotionRecipient:PublicKey.default}));
});
test('new launch and settlement builders preserve signed selections and the separate eighth vault',()=>{
  const built=buildAgencyMintV3InitializeInstruction({...input,shares,selectedAgents:['buyback-300k','x-promotion'],configRevision:'2'});
  assert.equal(built.selectedMask,5);assert.equal(built.instruction.data[20],5);assert.equal(built.instruction.data.readBigUInt64LE(21),2n);
  assert(built.instruction.keys[5].pubkey.equals(built.router.address));assert(built.instruction.keys[6].pubkey.equals(built.policy.address));
  const settled=buildAgencyMintV3SettlementInstruction({...input,claimId:Buffer.alloc(32,1),expectedLamports:'1000000000'});
  assert.equal(settled.instruction.keys.length,16);assert.equal(settled.vaults.length,8);assert(settled.instruction.keys[15].pubkey.equals(deriveAgencyVaultsV3(program,mint)[7]));
  assert(settled.instruction.keys[1].isSigner);assert(settled.instruction.keys[0].isSigner);
});
test('protected builders reject reclassification and agency funds cannot use generic disbursement',()=>{
  const args={...input,withdrawalId:Buffer.alloc(32,1),category:0,beneficiary:0,amount:'1',recipient:creator};
  const built=buildAgencyMintV3DisbursementInstruction(args);assert(built.instruction.keys[4].pubkey.equals(deriveAgencyPolicyV3(program,mint).address));
  assert.throws(()=>buildAgencyMintV3DisbursementInstruction({...args,category:7,beneficiary:9}));
  assert.throws(()=>buildAgencyMintV3DisbursementInstruction({...args,category:1,beneficiary:3,recipient:deriveAgencyVaultsV3(program,mint)[7]}));
});
test('promotion billing binds the verified post, monotonic sequence, exact amount and immutable policy',()=>{
  const built=buildAgencyPromotionV3Instruction({...input,promotionRecipient:billing,postId:'1234567890123456789',deliveryHash:Buffer.alloc(32,1),sequence:0,amount:'6666666',postedAt:1760000000});
  assert.equal(built.instruction.data.length,68);assert.equal(built.instruction.data.readBigUInt64LE(8),1234567890123456789n);
  assert.equal(built.instruction.data.readBigUInt64LE(52),6666666n);assert(built.instruction.keys[4].pubkey.equals(deriveAgencyVaultsV3(program,mint)[7]));
  assert.throws(()=>buildAgencyPromotionV3Instruction({...input,promotionRecipient:billing,postId:'1',deliveryHash:Buffer.alloc(32),sequence:0,amount:'1',postedAt:1760000000}));
});
