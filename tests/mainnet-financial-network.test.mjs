import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {readProgramDataEvidence} from '../server/program-data-evidence.mjs';
import {loadFinalizedV3PumpCollection} from '../server/v3-finalized-collection.mjs';
import {v3AllocationPlan} from '../server/v3-allocation-plan.mjs';
import {automaticV3Actions} from '../server/automatic-v3-actions.mjs';
import {indexCommunityClaims} from '../server/community-claim-index.mjs';
import {createCommunityClaimService} from '../server/community-claim-service.mjs';
import {readWalletTradeHistory} from '../server/wallet-trades.mjs';
import {deriveMintRouterV3} from '../mint-router-v3.js';

const key=n=>new PublicKey(new Uint8Array(32).fill(n)),cluster='mainnet-beta';
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
function programFixture(genesis=SOLANA_GENESIS[cluster]){
  let reads=0;
  const program=key(1),address=key(2),header=Buffer.alloc(36),data=Buffer.alloc(46);
  header.writeUInt32LE(2);address.toBuffer().copy(header,4);data.writeUInt32LE(3);
  const connection={getGenesisHash:async()=>genesis,getAccountInfo:async target=>{
    reads++;return target.equals(program)?{owner:loader,executable:true,data:header}:{owner:loader,executable:false,data};
  }};
  return {program,connection,reads:()=>reads};
}

test('Mainnet bytecode evidence binds the network before account reads',async()=>{
  const good=programFixture(),proof=await readProgramDataEvidence(good.connection,good.program,{cluster,rpcUrl:''});
  assert.match(proof.sha256,/^[a-f0-9]{64}$/);assert.equal(good.reads(),2);
  const wrong=programFixture(SOLANA_GENESIS.devnet);
  await assert.rejects(readProgramDataEvidence(wrong.connection,wrong.program,{cluster,rpcUrl:''}),/network/);
  assert.equal(wrong.reads(),0);
});

test('alternate bytecode RPC must match the selected Mainnet chain',async()=>{
  for(const genesis of [SOLANA_GENESIS.devnet,SOLANA_GENESIS[cluster]]){
    const primary=programFixture(),alternate=programFixture(genesis);
    const pending=readProgramDataEvidence(primary.connection,primary.program,{cluster,rpcUrl:'https://evidence.example',connectionFactory:()=>alternate.connection});
    if(genesis===SOLANA_GENESIS.devnet){await assert.rejects(pending,/selected network/);assert.equal(alternate.reads(),0);}
    else {assert.ok((await pending).sha256);assert.equal(alternate.reads(),2);}
    assert.equal(primary.reads(),0);
  }
});

function financialFixture(){
  const programId=key(1).toBase58(),mint=key(3).toBase58(),creatorWallet=key(4).toBase58();
  const router=deriveMintRouterV3(programId,mint).address.toBase58();
  const launch={onchainVerified:true,cluster,mint,creator:router,creatorWallet,
    xUserId:'123',pumpFeeRoute:{scope:'per-mint-v3',router,programId,transaction:'launch',initialAuthority:creatorWallet,protocolSplit:{agencyPercent:10}},
    feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:30,holderAirdropPercent:40,solClaimPercent:10},recipients:{xAccount:'@fixture'}}}};
  const settlement={cluster,mint,programId,expectedLamports:'10000',categoryLamports:['8000','800','60','25','15','400','500','200'],collectionSignature:'collection',settlementSignature:'settlement'};
  return {launch,settlement};
}

test('Mainnet allocation conserves all fee categories and rejects cross-network inputs',()=>{
  const f=financialFixture(),plan=v3AllocationPlan({...f,cluster});
  assert.equal(plan.cluster,cluster);assert.equal(plan.grossLamports,'10000');
  assert.deepEqual(plan.creatorDirected,{walletLamports:'3000',holderLamports:'4000',xLamports:'1000',xUserId:'123',xHandle:'@fixture'});
  assert.equal(Object.values(plan.creatorDirected).slice(0,3).reduce((n,v)=>n+BigInt(v),0n),8000n);
  const protocol=BigInt(plan.protocol.operationsLamports)+plan.protocol.referralLamports.reduce((n,v)=>n+BigInt(v),0n)
    +BigInt(plan.protocol.communityLamports)+BigInt(plan.protocol.buybackLamports)+BigInt(plan.agency.amountLamports);
  assert.equal(protocol,2000n);
  for(const changes of [{launch:{...f.launch,cluster:'devnet'}},{settlement:{...f.settlement,cluster:'devnet'}},{settlement:{...f.settlement,cluster:undefined}}])
    assert.throws(()=>v3AllocationPlan({...f,...changes,cluster}),/matching verified/);
  assert.throws(()=>v3AllocationPlan({...f,cluster,settlement:{...f.settlement,expectedLamports:'10001'}}),/reconcile/);
});

test('automatic actions require matching launch, settlement and allocation networks and skip recorded payouts',()=>{
  const f=financialFixture(),plan=v3AllocationPlan({...f,cluster});
  const state={launches:{[f.launch.mint]:f.launch},v3Settlements:{collection:{...f.settlement,status:'finalized',allocationPlan:plan}}};
  assert.equal(automaticV3Actions(state,cluster).length,3);assert.equal(automaticV3Actions(state,'devnet').length,0);
  state.v3OperationsPayout={collection:{status:'finalized'}};assert.equal(automaticV3Actions(state,cluster).length,2);
  state.v3Settlements.collection.cluster='devnet';assert.equal(automaticV3Actions(state,cluster).length,0);
});

test('collection verification rejects wrong RPC before launch, policy or receipt reads',async()=>{
  const f=financialFixture();let calls=0;
  await assert.rejects(loadFinalizedV3PumpCollection({...f,cluster,mint:f.launch.mint,programId:f.settlement.programId,signature:'collection',
    connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet},verifyLaunch:async()=>{calls++;}}),/network/);
  assert.equal(calls,0);
});

test('community indexing checks network before ledger reads and rejects unbound or cross-network manifests',async()=>{
  let reads=0;
  const base={cluster,programId:key(1),authority:key(2),eligibilityMint:key(3),expectedProgramDataSha256:'ab'.repeat(32),persist:false,
    ledger:{read:async()=>{reads++;return {}; }},programEvidence:async(_c,_p,options)=>{assert.equal(options.cluster,cluster);return {account:{executable:true},sha256:'ab'.repeat(32)};}};
  await assert.rejects(indexCommunityClaims({...base,connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet}}),/network/);assert.equal(reads,0);
  const connection={getGenesisHash:async()=>SOLANA_GENESIS[cluster]};
  assert.equal((await indexCommunityClaims({...base,connection})).cluster,cluster);
  await assert.rejects(indexCommunityClaims({...base,connection,ledger:{read:async()=>({communityDrops:{test:{openingSignature:'opened',programId:key(1).toBase58(),cluster:'devnet'}}})}}),/manifest network/);
});

test('Mainnet claims forbid QA cutoffs and foreign saved manifests',async()=>{
  const base={cluster,programId:key(1),authority:key(2),eligibilityMint:key(3),connection:{getGenesisHash:async()=>SOLANA_GENESIS[cluster]},
    store:{transaction:async()=>{},read:async()=>({communityDrops:{[key(4)]:{cluster:'devnet'}}})}};
  assert.throws(()=>createCommunityClaimService({...base,qaCutoffAuthority:key(2).toBase58()}),/QA snapshot/);
  const service=createCommunityClaimService(base);
  await assert.rejects(service.prepared(key(4)),/manifest network/);
  await assert.rejects(service.prepare({mint:key(5),creator:key(6),reservedTokens:30,fundingSignature:'fund',migrationSignature:'migrate',snapshotBasis:'devnet-qa-cutoff'}),/QA snapshots/);
});

test('wallet history reports the verified selected chain and refuses a different RPC',async()=>{
  let scans=0;const connection={getGenesisHash:async()=>SOLANA_GENESIS[cluster],getSignaturesForAddress:async()=>{scans++;return [];}};
  const result=await readWalletTradeHistory({connection,wallet:key(4),cluster});assert.equal(result.cluster,cluster);assert.equal(scans,1);
  await assert.rejects(readWalletTradeHistory({connection,wallet:key(4),cluster:'devnet'}),/network/);assert.equal(scans,1);
});
