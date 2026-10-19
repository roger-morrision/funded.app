import {Buffer} from 'buffer';
import {PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {deriveFeeRouter} from './fee-router.js';
import {deriveMintRouterV3,deriveMintClaimV3,directedGrossUnits,
  buildMintRouterV3SettlementInstruction} from './mint-router-v3.js';
import {buildProtectedMintV3ApprovalInstruction,buildProtectedMintV3DisbursementInstruction} from './protected-mint-router-v3.js';
import {canonicalAgencySelection,MARKETING_AGENCY_POLICY as POLICY} from './config/marketing-agency.js';

export const AGENCY_V3_DISCRIMINATORS=Object.freeze({
  initialize_agency_config_v3:'9499224dfd359bdb',update_agency_config_v3:'03446109a7439c95',
  initialize_agency_mint_v3:'2e7888a3cdecc35b',settle_agency_mint_v3:'7f493f692a129ef4',
  approve_agency_withdrawal_v3:'5aa819a4af260af8',disburse_agency_mint_v3:'20fbe4d5ce06717b',
  bill_agency_promotion_v3:'3c0ac017b74ea8e0',buyback_agency_mint_v3:'4327dcdb2e4fcf97',
  MintAgencyPolicyV3:'42306090e0e9719a',MintAgencyClaimV3:'9cb1a9997701bbe8',
  AgencyConfigV3:'2aae7101fdc712fb',AgencyPromotionV3:'abde59f76545eae1',AgencyBuybackV3:'82afbdaa281560e0',
});
export const agencyDiscriminator=name=>Buffer.from(AGENCY_V3_DISCRIMINATORS[name],'hex');
const key=value=>new PublicKey(value),max=0xffff_ffff_ffff_ffffn;
export function agencyU64(value,{positive=false}={}){
  if(typeof value==='number'&&!Number.isSafeInteger(value)||!/^(0|[1-9]\d*)$/.test(String(value)))throw new Error('An exact agency u64 is required.');
  const n=BigInt(value);if(n>max||positive&&n===0n)throw new Error('Agency amount is outside u64.');return n;
}
const u64=value=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(agencyU64(value));return data;};
const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey:key(pubkey),isSigner,isWritable});
export function agencyProtocolUnits(){return [POLICY.operationsUnits,...POLICY.referralUnits,POLICY.communityUnits,POLICY.fundedBuybackUnits,POLICY.agencyUnits];}
export function agencyProtocolSplit(units=agencyProtocolUnits()){
  agencyCategoryTargets('10000000',units);
  return{operationsPercent:units[0]/20000,referralLevelPercents:units.slice(1,4).map(n=>n/20000),
    communityPercent:units[4]/20000,buybackPercent:units[5]/20000,agencyPercent:units[6]/20000};
}
export function agencyCategoryTargets(total,units=agencyProtocolUnits()){
  if(!Array.isArray(units)||units.length!==7||units.some(n=>!Number.isInteger(n)||n<0)||units[6]!==200000
    ||units.reduce((sum,n)=>sum+n,0)!==2000000)throw new Error('Eight agency categories require a fixed 80% creator and 2% agency budget.');
  const amount=agencyU64(total);let cumulative=0n,prior=0n;
  return [8000000,...units].map(n=>{cumulative+=BigInt(n);const boundary=amount*cumulative/10000000n,delta=boundary-prior;prior=boundary;return delta;});
}
export function agencySelectionMask(selected){return canonicalAgencySelection(selected).reduce((mask,id)=>mask|(1<<POLICY.agents.findIndex(agent=>agent.id===id)),0);}
export function agencyAgentTargets(total,mask){
  if(!Number.isInteger(mask)||mask<0||mask>7)throw new Error('Invalid immutable agency selection.');
  const count=[0,1,2].filter(n=>mask&(1<<n)).length,amount=agencyU64(total);let ordinal=0n,prior=0n;
  return [0,1,2].map(n=>{if(!(mask&(1<<n)))return 0n;const boundary=amount*++ordinal/BigInt(count),delta=boundary-prior;prior=boundary;return delta;});
}
export const deriveAgencyConfigV3=program=>{const [address,bump]=PublicKey.findProgramAddressSync([Buffer.from('agency-config-v3')],key(program));return{address,bump};};
export const deriveAgencyPolicyV3=(program,mint)=>{const [address,bump]=PublicKey.findProgramAddressSync([Buffer.from('mint-agency-policy-v3'),key(mint).toBuffer()],key(program));return{address,bump};};
export const deriveAgencyVaultsV3=(program,mint)=>Array.from({length:8},(_,n)=>PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'),key(mint).toBuffer(),Buffer.from([n])],key(program))[0]);
export const deriveAgencyPromotionV3=(program,mint,postId)=>PublicKey.findProgramAddressSync([Buffer.from('agency-promotion-v3'),key(mint).toBuffer(),u64(postId)],key(program))[0];
function ownedBytes(account,program,name,length){
  const data=Buffer.from(account?.data||[]);
  if(!account?.owner?.equals(key(program))||account.executable||data.length!==length||!data.subarray(0,8).equals(agencyDiscriminator(name)))throw new Error('Agency account owner, discriminator or layout differs.');
  return data;
}
export function decodeAgencyConfigV3(account,program){
  const data=ownedBytes(account,program,'AgencyConfigV3',77),protocolUnits=Array.from({length:7},(_,n)=>data.readUInt32LE(8+n*4));
  agencyCategoryTargets('10000000',protocolUnits);
  const recipient=new PublicKey(data.subarray(36,68)),revision=data.readBigUInt64LE(68),{bump}=deriveAgencyConfigV3(program);
  if(recipient.equals(PublicKey.default)||revision<1n||data[76]!==bump)throw new Error('Agency configuration is invalid.');
  return{protocolUnits,promotionRecipient:recipient.toBase58(),revision:String(revision),bump};
}
export function decodeAgencyPolicyV3(account,{programId,mint,creator,initialAuthority,protocolUnits:expectedUnits,shares,selectedAgents}){
  const data=ownedBytes(account,programId,'MintAgencyPolicyV3',383),identity=deriveAgencyPolicyV3(programId,mint);
  if(!data.subarray(8,40).equals(key(mint).toBuffer())||!data.subarray(40,72).equals(key(creator).toBuffer())
    ||!data.subarray(72,104).equals(key(initialAuthority).toBuffer())||data[382]!==identity.bump)throw new Error('Agency mint identity differs.');
  const protocolUnits=Array.from({length:7},(_,n)=>data.readUInt32LE(104+n*4)),settledLamports=data.readBigUInt64LE(132);
  const paidLamports=Array.from({length:8},(_,n)=>data.readBigUInt64LE(140+n*8)),withdrawnLamports=Array.from({length:8},(_,n)=>data.readBigUInt64LE(204+n*8));
  const directedUnits=Array.from({length:3},(_,n)=>data.readUInt32LE(268+n*4)),directedReleased=Array.from({length:3},(_,n)=>data.readBigUInt64LE(280+n*8));
  const selectedMask=data[304],agentSpent=Array.from({length:3},(_,n)=>data.readBigUInt64LE(305+n*8)),completedMask=data[329];
  const lastPromotionAt=data.readBigInt64LE(330),promotionSequence=data.readUInt32LE(338),promotionRecipient=new PublicKey(data.subarray(342,374)).toBase58(),configRevision=data.readBigUInt64LE(374);
  const targets=agencyCategoryTargets(settledLamports,protocolUnits),agentTargets=agencyAgentTargets(paidLamports[7],selectedMask);
  let prefix=0n,prior=0n;const directedTargets=directedUnits.map(n=>{prefix+=BigInt(n);const boundary=paidLamports[0]*prefix/8000000n,delta=boundary-prior;prior=boundary;return delta;});
  if(expectedUnits&&expectedUnits.some((n,i)=>n!==protocolUnits[i])||expectedUnits&&expectedUnits.length!==7
    ||shares&&directedGrossUnits(shares).some((n,i)=>n!==directedUnits[i])
    ||selectedAgents&&agencySelectionMask(selectedAgents)!==selectedMask
    ||directedUnits.reduce((sum,n)=>sum+n,0)!==8000000||paidLamports.some((n,i)=>n!==targets[i])
    ||withdrawnLamports.some((n,i)=>n>paidLamports[i])||directedReleased.some((n,i)=>n>directedTargets[i])
    ||directedReleased.reduce((sum,n)=>sum+n,0n)!==withdrawnLamports[0]
    ||agentSpent.some((n,i)=>n>agentTargets[i])||agentSpent.reduce((sum,n)=>sum+n,0n)!==withdrawnLamports[7]
    ||completedMask&~selectedMask||completedMask&1||lastPromotionAt<0n||configRevision<1n||promotionRecipient===PublicKey.default.toBase58()
    ||(promotionSequence===0)!==(lastPromotionAt===0n)||promotionSequence>0&&(!(selectedMask&1)||agentSpent[0]===0n)
    ||[1,2].some(n=>Boolean(completedMask&(1<<n))!==(agentSpent[n]>0n)))throw new Error('Agency immutable rates, selections or released counters differ.');
  return{...identity,verified:true,reason:'verified',agencyPolicy:true,protectedPolicy:true,protocolUnits,settledLamports,
    paidLamports,withdrawnLamports,directedUnits,directedReleased,selectedMask,agentSpent,agentTargets,completedMask,
    lastPromotionAt,promotionSequence,promotionRecipient,configRevision};
}
export function decodeAgencyClaimV3(account,{programId,mint,claimId,expectedLamports}){
  const data=ownedBytes(account,programId,'MintAgencyClaimV3',152),amount=agencyU64(expectedLamports,{positive:true});
  const categories=Array.from({length:8},(_,n)=>data.readBigUInt64LE(80+n*8));
  if(Buffer.from(claimId).length!==32||!data.subarray(8,40).equals(Buffer.from(claimId))||!data.subarray(40,72).equals(key(mint).toBuffer())
    ||data.readBigUInt64LE(72)!==amount||categories.reduce((sum,n)=>sum+n,0n)!==amount)throw new Error('Agency claim identity or allocation differs.');
  return{address:deriveMintClaimV3(programId,mint,claimId),verified:true,agencyPolicy:true,categoryLamports:categories,createdAt:data.readBigInt64LE(144)};
}
export function buildAgencyConfigV3Instruction({programId,authority,protocolUnits=agencyProtocolUnits(),promotionRecipient,expectedRevision}){
  agencyCategoryTargets('10000000',protocolUnits);const initialize=expectedRevision===undefined,config=deriveAgencyConfigV3(programId);
  const recipient=key(promotionRecipient);if(recipient.equals(PublicKey.default))throw new Error('A promotion billing recipient is required.');
  const rates=Buffer.alloc(28);protocolUnits.forEach((n,i)=>rates.writeUInt32LE(n,i*4));
  const data=Buffer.concat([agencyDiscriminator(initialize?'initialize_agency_config_v3':'update_agency_config_v3'),rates,recipient.toBuffer(),...(initialize?[]:[u64(expectedRevision)])]);
  return{config,instruction:new TransactionInstruction({programId:key(programId),data,keys:[meta(authority,true,initialize),meta(deriveFeeRouter(programId).address),
    meta(config.address,false,true),...(initialize?[meta(SystemProgram.programId)]:[])]})};
}
export function buildAgencyMintV3InitializeInstruction({programId,mint,authority,creator,shares,selectedAgents=[],configRevision}){
  const directedUnits=directedGrossUnits(shares),mask=agencySelectionMask(selectedAgents),router=deriveMintRouterV3(programId,mint),policy=deriveAgencyPolicyV3(programId,mint);
  const directed=Buffer.alloc(12);directedUnits.forEach((n,i)=>directed.writeUInt32LE(n,i*4));
  return{router,policy,selectedMask:mask,directedUnits,instruction:new TransactionInstruction({programId:key(programId),
    data:Buffer.concat([agencyDiscriminator('initialize_agency_mint_v3'),directed,Buffer.from([mask]),u64(configRevision)]),
    keys:[meta(authority),meta(creator,true,true),meta(mint,true),meta(deriveFeeRouter(programId).address),meta(deriveAgencyConfigV3(programId).address),
      meta(router.address,false,true),meta(policy.address,false,true),meta(SystemProgram.programId)]})};
}
export function buildAgencyMintV3SettlementInstruction(input){
  const result=buildMintRouterV3SettlementInstruction(input),policy=deriveAgencyPolicyV3(input.programId,input.mint),vaults=deriveAgencyVaultsV3(input.programId,input.mint);
  const data=Buffer.from(result.instruction.data);agencyDiscriminator('settle_agency_mint_v3').copy(data);
  const keys=result.instruction.keys.slice(0,8);keys[5]=meta(policy.address,false,true);keys.push(...vaults.map(pubkey=>meta(pubkey,false,true)));
  return{...result,policy,vaults,instruction:new TransactionInstruction({programId:key(input.programId),data,keys})};
}
function adaptProtected(input,approval){
  const result=(approval?buildProtectedMintV3ApprovalInstruction:buildProtectedMintV3DisbursementInstruction)(input),policy=deriveAgencyPolicyV3(input.programId,input.mint);
  if(deriveAgencyVaultsV3(input.programId,input.mint).some(v=>v.equals(key(input.recipient)))||deriveMintRouterV3(input.programId,input.mint).address.equals(key(input.recipient)))throw new Error('Agency categories cannot be reclassified.');
  const data=Buffer.from(result.instruction.data);agencyDiscriminator(approval?'approve_agency_withdrawal_v3':'disburse_agency_mint_v3').copy(data);
  const keys=result.instruction.keys.map((entry,i)=>i===4?{...entry,pubkey:policy.address}:entry);
  return{...result,policy,instruction:new TransactionInstruction({programId:key(input.programId),data,keys})};
}
export const buildAgencyMintV3ApprovalInstruction=input=>adaptProtected(input,true);
export const buildAgencyMintV3DisbursementInstruction=input=>adaptProtected(input,false);
export function buildAgencyPromotionV3Instruction({programId,mint,authority,promotionRecipient,postId,deliveryHash,sequence,amount,postedAt}){
  const hash=Buffer.from(deliveryHash),seq=Buffer.alloc(4),time=Buffer.alloc(8);
  if(hash.length!==32||hash.equals(Buffer.alloc(32))||!Number.isSafeInteger(sequence)||sequence<0||sequence>0xffffffff
    ||agencyU64(postId,{positive:true})===0n||!Number.isSafeInteger(postedAt)||postedAt<1)throw new Error('Verified agency delivery identity is required.');
  seq.writeUInt32LE(sequence);time.writeBigInt64LE(BigInt(postedAt));agencyU64(amount,{positive:true});
  const receipt=deriveAgencyPromotionV3(programId,mint,postId),policy=deriveAgencyPolicyV3(programId,mint),vault=deriveAgencyVaultsV3(programId,mint)[7];
  return{receipt,policy,vault,instruction:new TransactionInstruction({programId:key(programId),
    data:Buffer.concat([agencyDiscriminator('bill_agency_promotion_v3'),u64(postId),hash,seq,u64(amount),time]),
    keys:[meta(authority,true,true),meta(mint),meta(deriveFeeRouter(programId).address),meta(policy.address,false,true),meta(vault,false,true),
      meta(promotionRecipient,false,true),meta(receipt,false,true),meta(SystemProgram.programId)]})};
}
