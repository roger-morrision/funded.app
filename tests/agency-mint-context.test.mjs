import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram} from '@solana/web3.js';
import {AGENCY_V3_DISCRIMINATORS,agencyProtocolUnits,agencyProtocolSplit,agencyCategoryTargets,deriveAgencyPolicyV3} from '../agency-mint-router-v3.js';
import {deriveMintRouterV3} from '../mint-router-v3.js';
import {readAgencyMintContext} from '../server/agency-mint-context.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
const key=n=>Keypair.fromSeed(Buffer.alloc(32,n)).publicKey;
function fixture(){
  const [program,mint,creator,authority,billing]=[161,162,163,164,165].map(key),id=mint.toBase58(),hash='a'.repeat(64),source='s'.repeat(64);
  const data=Buffer.alloc(383);Buffer.from(AGENCY_V3_DISCRIMINATORS.MintAgencyPolicyV3,'hex').copy(data);
  mint.toBuffer().copy(data,8);creator.toBuffer().copy(data,40);authority.toBuffer().copy(data,72);
  agencyProtocolUnits().forEach((n,i)=>data.writeUInt32LE(n,104+i*4));data.writeBigUInt64LE(1000000000n,132);
  agencyCategoryTargets('1000000000').forEach((n,i)=>data.writeBigUInt64LE(n,140+i*8));
  [6000000,1000000,1000000].forEach((n,i)=>data.writeUInt32LE(n,268+i*4));data[304]=1;
  billing.toBuffer().copy(data,342);data.writeBigUInt64LE(1n,374);data[382]=deriveAgencyPolicyV3(program,mint).bump;
  const router=deriveMintRouterV3(program,mint).address.toBase58(),claimId=Buffer.alloc(32,1);
  const launch={onchainVerified:true,cluster:'devnet',mint:id,creator:router,creatorWallet:creator.toBase58(),signature:'launch',
    marketingAgency:{version:'marketing-agency-v1',selectedAgents:['x-promotion']},
    feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:60,holderAirdropPercent:10,solClaimPercent:10}}},
    pumpFeeRoute:{verified:true,scope:'per-mint-v3',programId:program.toBase58(),initialAuthority:authority.toBase58(),router,
      protocolSplit:agencyProtocolSplit(),transaction:'launch'}};
  const state={launches:{[id]:launch},collections:{[source]:{signature:source,mint:id,scope:'per-mint-v3',cluster:'devnet',
    status:'collected',onchainVerified:true,attribution:'mint-verified',programId:program.toBase58(),claimId:claimId.toString('hex'),collectedLamports:'1000000000'}},
    v3Settlements:{[source]:{mint:id,status:'finalized',collectionSignature:source,settlementSignature:'settled'}}};
  const snapshot={context:{slot:300},value:[{owner:program,data},{owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:21000000}]};
  const creation={onchainVerified:true,mint:id,creator:router,feePayer:creator.toBase58(),signature:'launch',slot:100,name:'Verified name',symbol:'QA'};
  const settled={mint:id,signature:'settled',slot:200,expectedLamports:'1000000000',categoryLamports:agencyCategoryTargets('1000000000').map(String)};
  const input={connection:{getGenesisHash:async()=>DEVNET_GENESIS_HASH,getMultipleAccountsInfoAndContext:async()=>snapshot,
    getMinimumBalanceForRentExemption:async()=>1000000,getBalance:async()=>1000000},
    state,mint:id,programId:program.toBase58(),authority,approvedHash:hash,
    readProgram:async()=>({sha256:hash,account:{executable:true}}),verifyRelease:(evidence,_program,expected)=>evidence.sha256===expected,
    verifyRouter:async()=>({verified:true,authority}),
    verifyLaunch:async()=>creation,loadCollection:async()=>({signature:source,router,claimId,expectedLamports:'1000000000'}),loadSettlement:async()=>settled};
  return{input,data,state,launch,snapshot,creation,settled,source};
}
test('agency context independently binds custody and every finalized Pump source to the immutable mint',async()=>{
  const f=fixture(),result=await readAgencyMintContext(f.input);
  assert.equal(result.verified,true);assert.equal(result.remainingLamports,'20000000');assert.deepEqual(result.agentRemaining,['20000000','0','0']);
  assert.equal(result.launch.name,'Verified name');assert.equal(result.proofs.length,2);assert.equal(result.proofs[0].slot,100);
  assert.equal(result.promotionRecipientReady,true);
});
test('a donation, offchain allocation, stale snapshot, changed launch, or wrong network cannot establish agency funding',async()=>{
  const failures=[f=>delete f.state.v3Settlements[f.source],f=>f.state.collections[f.source].attribution='unverified',
    f=>f.snapshot.value[1].lamports--,f=>f.snapshot.context.slot=199,f=>delete f.creation.slot,
    f=>f.creation.feePayer=key(166).toBase58(),f=>f.launch.marketingAgency.selectedAgents=[],
    f=>f.input.connection.getGenesisHash=async()=>'mainnet',f=>f.input.readProgram=async()=>({sha256:'b'.repeat(64),account:{executable:true}}),
    f=>f.settled.categoryLamports=f.settled.categoryLamports.slice(0,7)];
  for(const mutate of failures){const f=fixture();mutate(f);await assert.rejects(()=>readAgencyMintContext(f.input));}
});
