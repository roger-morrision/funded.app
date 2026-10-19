import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction} from '@solana/web3.js';
import {agencyDiscriminator,agencyProtocolUnits,agencyProtocolSplit,agencyCategoryTargets,deriveAgencyPolicyV3,
  buildAgencyMintV3SettlementInstruction} from '../agency-mint-router-v3.js';
import {loadFinalizedV3Settlement} from '../server/v3-settlement-proof.mjs';
import {v3AllocationPlan} from '../server/v3-allocation-plan.mjs';
import {buildFeeDistributionPolicy,calculateCreatorFeeClaim,validateProtocolFeeSplit} from '../distribution-policy.js';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
test('eight-category signed settlement, raw account decoders, receipt proof and obligations preserve the dedicated 2% agency budget',async()=>{
  const [programId,mint,creator,authority,billing]=[211,212,213,214,215].map(key),claimId=Buffer.alloc(32,9),signature='1'.repeat(64);
  const split=agencyProtocolSplit(),gross='100000000000',targets=agencyCategoryTargets(gross),shares={creatorWalletPercent:60,holderAirdropPercent:10,solClaimPercent:10};
  const built=buildAgencyMintV3SettlementInstruction({programId,mint,creator,authority,claimId,expectedLamports:gross});
  const message=new Transaction({feePayer:authority,recentBlockhash:key(216).toBase58()}).add(built.instruction).compileMessage();
  const keys=message.accountKeys.map(row=>row.toBase58()),before=keys.map(()=>0),after=[...before],ri=keys.indexOf(built.router.address.toBase58());
  before[ri]=Number(gross);targets.forEach((n,i)=>after[keys.indexOf(built.vaults[i].toBase58())]=Number(n));
  const policy=Buffer.alloc(383);agencyDiscriminator('MintAgencyPolicyV3').copy(policy);mint.toBuffer().copy(policy,8);creator.toBuffer().copy(policy,40);authority.toBuffer().copy(policy,72);
  agencyProtocolUnits().forEach((n,i)=>policy.writeUInt32LE(n,104+i*4));policy.writeBigUInt64LE(BigInt(gross),132);targets.forEach((n,i)=>policy.writeBigUInt64LE(n,140+i*8));
  [6000000,1000000,1000000].forEach((n,i)=>policy.writeUInt32LE(n,268+i*4));policy[304]=7;billing.toBuffer().copy(policy,342);policy.writeBigUInt64LE(1n,374);policy[382]=deriveAgencyPolicyV3(programId,mint).bump;
  const claim=Buffer.alloc(152);agencyDiscriminator('MintAgencyClaimV3').copy(claim);claimId.copy(claim,8);mint.toBuffer().copy(claim,40);claim.writeBigUInt64LE(BigInt(gross),72);
  targets.forEach((n,i)=>claim.writeBigUInt64LE(n,80+i*8));claim.writeBigInt64LE(1761000000n,144);
  const transaction={slot:500,blockTime:1761000000,transaction:{signatures:[signature],message},meta:{err:null,preBalances:before,postBalances:after}};
  const connection={getTransaction:async()=>transaction,getAccountInfo:async address=>({owner:programId,data:address.equals(built.claim)?claim:policy})};
  const input={connection,signature,programId,mint,creator,authority,claimId,expectedLamports:gross,split};
  const proof=await loadFinalizedV3Settlement(input);assert.equal(proof.categoryLamports.length,8);assert.equal(proof.categoryLamports[7],'2000000000');
  const feeDistribution=buildFeeDistributionPolicy({...shares,xRecipient:'@JohnTrand83'},{fundedSplit:split});
  const launch={mint:mint.toBase58(),onchainVerified:true,cluster:'devnet',creatorWallet:creator.toBase58(),xUserId:'123',
    pumpFeeRoute:{protocolSplit:split,scope:'per-mint-v3',programId:programId.toBase58()},feeDistribution};
  const plan=v3AllocationPlan({launch,settlement:{...proof,programId:programId.toBase58(),collectionSignature:'collection',settlementSignature:signature}});
  assert.equal(plan.protocol.operationsLamports,'8000000000');assert.equal(plan.protocol.referralLamports.reduce((n,row)=>n+BigInt(row),0n),1000000000n);
  assert.equal(plan.protocol.buybackLamports,'5000000000');assert.equal(plan.agency.amountLamports,'2000000000');
  // Old seven-category bytes and a reclassified eighth amount are rejected.
  claim[0]^=1;assert.equal(await loadFinalizedV3Settlement(input),null);claim[0]^=1;
  policy.writeBigUInt64LE(1999999999n,196);assert.equal(await loadFinalizedV3Settlement(input),null);
});
test('100-SOL public calculator matches the new 80/8/1/2/4/5 policy without changing historical policy shapes',()=>{
  const split=agencyProtocolSplit(),fee=buildFeeDistributionPolicy({creatorWalletPercent:80},{fundedSplit:split});
  const result=calculateCreatorFeeClaim(100,{creatorWalletPercent:80},{fixedFunded:fee.fixedFunded,referralRecipients:['one','two','three']});
  assert.equal(result.creatorTotal,80);assert.equal(result.fundedApp.operations,8);assert.equal(result.fundedApp.agency,2);
  assert.equal(result.fundedApp.communityBase,4);assert.equal(result.fundedApp.buyback,5);assert.equal(result.fundedApp.referralPayout,1);assert.equal(result.totalAllocated,100);
  const old=validateProtocolFeeSplit({operationsPercent:40,referralLevelPercents:[10,3,2],communityPercent:20,buybackPercent:25});
  assert.equal(Object.hasOwn(old,'agencyPercent'),false);
});
