import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {Keypair,Transaction} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {deriveMintRouterV3} from '../mint-router-v3.js';
import {buildV3PolicySettlement} from '../server/v3-policy-builders.mjs';
import {loadFinalizedV3Settlement} from '../server/v3-settlement-proof.mjs';
import {loadV3SettlementPosition} from '../server/v3-settlement-position.mjs';
import {QA_RECOVERY_DISCRIMINATOR} from '../server/devnet-qa-settlement-recovery.mjs';
import {createV3CreatorSettlementRoutes} from '../server/routes/v3-creator-settlement.mjs';
import {financialRecordNetwork} from '../server/financial-network.mjs';
import {readFinalizedV3Allocations} from '../server/v3-allocation-reconciliation.mjs';

const key=()=>Keypair.generate(),cluster='mainnet-beta';
function fixture(selected=cluster){
  const authority=key(),creator=key(),program=key().publicKey,mint=key().publicKey.toBase58();
  const programId=program.toBase58(),claimId=Buffer.alloc(32,7),source=bs58.encode(Buffer.alloc(64,8));
  const router=deriveMintRouterV3(program,mint).address.toBase58(),hash='ab'.repeat(32);
  const split={agencyPercent:10};
  const launch={onchainVerified:true,cluster:selected,mint,creatorWallet:creator.publicKey.toBase58(),
    pumpFeeRoute:{scope:'per-mint-v3',programId,router,initialAuthority:authority.publicKey.toBase58(),protocolSplit:split},
    feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0},recipients:{}}}};
  const collection={cluster:selected,signature:source,mint,scope:'per-mint-v3',status:'collected',onchainVerified:true,
    attribution:'mint-verified',programId,router,collectedLamports:10000,claimId:claimId.toString('hex')};
  return{authority,creator,programId,mint,claimId,source,router,hash,split,launch,collection,selected};
}
function routeFixture(selected=cluster,overrides={}){
  const f=fixture(selected),state={launches:{[f.mint]:f.launch},collections:{[f.source]:f.collection},v3Settlements:{}};
  const calls={submitted:0,readiness:0,source:0,proof:0,signer:0};let response;
  const sourceProof={cluster:selected,signature:f.source,router:f.router,expectedLamports:10000n,claimId:f.claimId};
  const proof=signature=>({cluster:selected,genesisHash:SOLANA_GENESIS[selected],signature,slot:91,mint:f.mint,router:f.router,
    claimId:f.claimId.toString('hex'),expectedLamports:'10000',categoryLamports:['8000','800','60','25','15','400','500','200']});
  const connection={getGenesisHash:async()=>SOLANA_GENESIS[selected],getLatestBlockhash:async()=>({blockhash:key().publicKey.toBase58(),lastValidBlockHeight:1000})};
  const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
  const dependencies={body:async()=>({mint:f.mint,collectionSignature:f.source}),store,solanaCluster:selected,solanaRpcUrl:'mock:rpc',
    env:{FUNDED_V3_SETTLEMENT_ENABLED:'true',FUNDED_V3_AUTO_SETTLEMENT_ENABLED:'true',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:f.programId,FUNDED_V3_PROGRAM_DATA_SHA256:f.hash},
    v3AuthorityKeypair:()=>{calls.signer++;return f.authority;},requireAuthorized:()=>true,originAllowed:()=>true,
    connectionFactory:()=>connection,programAllowed:()=>true,
    verifyReadiness:async input=>{calls.readiness++;assert.equal(input.cluster,selected);return{ready:true,configuredRouter:f.router};},
    loadCollection:async input=>{calls.source++;assert.equal(input.cluster,selected);return sourceProof;},
    loadSettlement:async input=>{calls.proof++;assert.equal(input.cluster,selected);return proof(input.signature);},
    submitTransaction:async({transaction})=>{
      calls.submitted++;const signature=bs58.encode(transaction.signature),saved=state.v3Settlements[f.source];
      assert.equal(saved.settlementSignature,signature);assert.equal(saved.cluster,selected);assert.equal(saved.programId,f.programId);
      assert.equal(saved.genesisHash,SOLANA_GENESIS[selected]);
      assert.equal(saved.signedTransaction,transaction.serialize().toString('base64'));
      assert.equal(transaction.verifySignatures(),true);return signature;
    },retryState:async()=>({retry:false,reason:'Finality unknown'}),respond:(_res,status,data)=>{response={status,data};}};
  const invoke=async options=>{
    const handler=createV3CreatorSettlementRoutes({...dependencies,...overrides,...options});
    await handler({method:'POST'},{},new URL('https://fixture.invalid/api/keeper/settle-v3'));
    return response;
  };
  return{...f,state,calls,connection,dependencies,proof,invoke};
}

test('settlement journals exact signed bytes before submission, conserves categories and rechecks finality on replay',async()=>{
  for(const selected of ['devnet',cluster]){
    const f=routeFixture(selected),first=await f.invoke();assert.equal(first.status,200);
    assert.equal(first.data.cluster,selected);assert.equal(first.data.programId,f.programId);
    assert.equal(first.data.allocationPlan.status,'allocated-not-funded');assert.equal(first.data.allocationPlan.grossLamports,'10000');
    assert.equal(first.data.allocationPlan.creatorDirected.walletLamports,'8000');
    assert.equal((await f.invoke()).status,200);assert.equal(f.calls.submitted,1);assert.equal(f.calls.proof,2);
  }
});
test('placeholder Mainnet release is blocked before loading the authority signer',async()=>{
  const f=routeFixture(),result=await f.invoke({programAllowed:undefined});
  assert.equal(result.status,503);assert.equal(f.calls.signer,0);assert.equal(f.calls.submitted,0);
});

test('concurrent finalization of the same proven settlement returns its receipt without resubmission',async()=>{
  for(const selected of ['devnet',cluster]){
    const f=routeFixture(selected);
    const result=await f.invoke({loadSettlement:async input=>{
      const proof=f.proof(input.signature);
      Object.assign(f.state.v3Settlements[f.source],proof,{status:'finalized'});
      return proof;
    }});
    assert.equal(result.status,200);assert.equal(result.data.status,'finalized');
    assert.equal(result.data.settlementSignature,f.state.v3Settlements[f.source].settlementSignature);
    assert.equal(f.calls.submitted,1);
  }
});

test('concurrent finalized records still reject changed network, signature, program or category amounts',async()=>{
  for(const changes of [{cluster:'devnet'},{settlementSignature:'other'},{programId:key().publicKey.toBase58()},
    {approvedHash:'ff'.repeat(32)},{categoryLamports:['10000','0','0','0','0','0','0','0']}]){
    const f=routeFixture();
    const result=await f.invoke({loadSettlement:async input=>{
      const proof=f.proof(input.signature);
      Object.assign(f.state.v3Settlements[f.source],proof,{status:'finalized'},changes);
      return proof;
    }});
    assert.equal(result.status,409);assert.equal(f.calls.submitted,1);
  }
});
test('wrong RPC and cross-network stored sources cannot prepare a settlement',async()=>{
  const f=routeFixture();f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  assert.equal((await f.invoke()).status,503);assert.equal(f.calls.readiness,0);assert.equal(f.calls.submitted,0);
  for(const bucket of ['launches','collections']){
    const g=routeFixture();Object.values(g.state[bucket])[0].cluster='devnet';
    assert.equal((await g.invoke()).status,409);assert.equal(g.calls.readiness,0);assert.equal(g.calls.submitted,0);
  }
});
test('foreign or unbound prior settlement cannot be returned or retried',async()=>{
  for(const changes of [{cluster:'devnet'},{cluster:undefined},{programId:key().publicKey.toBase58()},
    {mint:key().publicKey.toBase58()},{approvedHash:'ff'.repeat(32)}]){
    const f=routeFixture();f.state.v3Settlements[f.source]={...f.proof('saved'),collectionSignature:f.source,
      programId:f.programId,approvedHash:f.hash,status:'finalized',settlementSignature:'saved',...changes};
    assert.equal((await f.invoke()).status,409);assert.equal(f.calls.submitted,0);assert.equal(f.calls.proof,0);
  }
});
test('a finalized label without proof and an uncertain pending signature never authorize another transfer',async()=>{
  for(const status of ['finalized','verification-pending']){
    const f=routeFixture();f.state.v3Settlements[f.source]={...f.proof('saved'),collectionSignature:f.source,
      programId:f.programId,approvedHash:f.hash,status,settlementSignature:'saved'};
    assert.equal((await f.invoke({loadSettlement:async()=>null})).status,409);assert.equal(f.calls.submitted,0);
  }
});
test('cross-network finalized proof cannot become a Mainnet allocation',async()=>{
  const f=routeFixture();await assert.rejects(()=>f.invoke({loadSettlement:async input=>({...f.proof(input.signature),cluster:'devnet'})}),/proof is unavailable/);
  assert.equal(f.state.v3Settlements[f.source].status,'verification-pending');assert.equal(f.calls.submitted,1);
});
test('source change during preparation stops before submission',async()=>{
  const f=routeFixture();const store={...f.dependencies.store,update:async fn=>{
    f.state.collections[f.source].cluster='devnet';return fn(f.state);
  }};
  assert.equal((await f.invoke({store})).status,409);assert.equal(f.calls.submitted,0);
});

function transactionFixture(){
  const f=fixture(),input={connection:null,programId:f.programId,mint:f.mint,authority:f.authority.publicKey,
    creator:f.creator.publicKey,claimId:f.claimId,expectedLamports:10000,split:f.split,cluster};
  const built=buildV3PolicySettlement(input),tx=new Transaction({feePayer:f.authority.publicKey,recentBlockhash:key().publicKey.toBase58()}).add(built.instruction);
  tx.sign(f.authority,f.creator);const signature=bs58.encode(tx.signature),message=tx.compileMessage();
  const preBalances=message.accountKeys.map(()=>100000),postBalances=[...preBalances];
  postBalances[message.accountKeys.findIndex(k=>k.toBase58()===f.router)]-=10000;
  let reads=0;const transaction={slot:99,meta:{err:null,preBalances,postBalances},transaction:{message,signatures:[signature]}};
  const connection={getGenesisHash:async()=>SOLANA_GENESIS[cluster],getTransaction:async()=>{reads++;return transaction;}};
  return{...f,input:{...input,signature,connection,verifyClaim:async()=>({verified:true,address:built.claim,categoryLamports:[8000n,800n,60n,25n,15n,400n,500n,200n]}),
    verifyPolicy:async()=>({verified:true,address:built.policy.address,settledLamports:10000n})},connection,transaction,reads:()=>reads};
}
test('settlement chain proof is network-labelled and rejects wrong genesis before reading transactions',async()=>{
  const f=transactionFixture(),proof=await loadFinalizedV3Settlement(f.input);
  assert(proof);assert.equal(proof.cluster,cluster);assert.equal(proof.genesisHash,SOLANA_GENESIS[cluster]);
  f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  assert.equal(await loadFinalizedV3Settlement(f.input),null);assert.equal(f.reads(),1);
  await assert.rejects(()=>loadV3SettlementPosition({...f.input,slot:99}),/network/);
});
test('Mainnet rejects the historical QA recovery discriminator even in a successful transaction',async()=>{
  const f=transactionFixture(),ix=f.transaction.transaction.message.instructions[0],data=Buffer.from(bs58.decode(ix.data));
  QA_RECOVERY_DISCRIMINATOR.copy(data);ix.data=bs58.encode(data);
  assert.equal(await loadFinalizedV3Settlement(f.input),null);
});
test('cumulative allocation cannot relabel a Devnet proof as Mainnet',async()=>{
  const f=routeFixture();await f.invoke();
  await assert.rejects(()=>readFinalizedV3Allocations({store:f.dependencies.store,connection:f.connection,mint:f.mint,cluster,
    loadSettlement:async input=>{assert.equal(input.cluster,cluster);return{...f.proof(input.signature),cluster:'devnet',position:{}};}}),/evidence is unavailable/);
  assert.equal(financialRecordNetwork({cluster,genesisHash:SOLANA_GENESIS.devnet},cluster),false);
});
