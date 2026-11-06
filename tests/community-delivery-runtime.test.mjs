import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createCommunityDeliveryRuntime} from '../server/community-delivery-runtime.mjs';
const pair=n=>Keypair.fromSeed(Buffer.alloc(32,n)),authority=pair(121),mint=String(pair(122).publicKey),program=String(pair(123).publicKey);
function fixture(){
  const launch={mint,onchainVerified:true,cluster:'devnet',creatorWallet:String(pair(124).publicKey),communityAirdrop:{reservedTokens:30000000},
    pumpFeeRoute:{scope:'per-mint-v3',verified:true,programId:program,initialAuthority:String(authority.publicKey)}};
  const ledger={},app={launches:{[mint]:launch},communityReserveReceipts:{[mint]:{signature:'funding'}}};let preparations=0,payments=0,gate=null;
  const record={mint,snapshotBasis:'pump-migration',openingSignature:'opening',manifest:{leaves:[{recipient:String(pair(125).publicKey),amount:'100',index:0}]}};
  const options={store:{read:async()=>app},automaticRewardStore:{read:async()=>structuredClone(ledger),transaction:async fn=>fn(ledger)},
    solanaCluster:'devnet',solanaRpcUrl:'https://fixture.invalid',fundedTokenMint:String(pair(126).publicKey),v3AuthorityKeypair:()=>authority,connection:{},logger:{error:()=>{}},
    env:{FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED:'true',FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program,FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64)},
    scanPools:async(_c,ids)=>new Map(ids.map(id=>[id,123])),findMigration:async()=>{if(gate)await gate;return 'migration';},serviceFactory:()=>({prepare:async input=>{assert.equal(input.migrationSignature,'migration');preparations++;ledger.communityDrops={[mint]:record};return record;}}),
    deliveryFactory:()=>({pay:async()=>{payments++;return {status:'finalized'};}})};
  return {options,ledger,app,record,get preparations(){return preparations;},get payments(){return payments;},hold:promise=>gate=promise};
}
test('discovery captures immutable migration holdings before the separate automatic delivery pass',async()=>{
  const f=fixture(),runtime=createCommunityDeliveryRuntime(f.options);
  await runtime.tick();assert.equal(f.payments,0);assert.equal(f.preparations,0);
  await runtime.tick({preparationOnly:true});assert.equal(f.preparations,1);assert.equal(f.payments,0);
  await runtime.tick();assert.equal(f.payments,1);assert.equal(f.ledger.communityDeliveryStatus.paid,1);
  await runtime.tick({preparationOnly:true});assert.equal(f.preparations,1);
});
test('no activation, wrong network, missing funding and historical QA cutoffs never send automatically',async()=>{
  for(const kind of ['disabled','mainnet','funding','qa']){
    const f=fixture();if(kind==='disabled')f.options.env.FUNDED_COMMUNITY_AUTO_DELIVERY_ENABLED='false';
    if(kind==='mainnet')f.options.solanaCluster='mainnet-beta';if(kind==='funding')f.app.communityReserveReceipts={};
    if(kind==='qa')f.ledger.communityDrops={[mint]:{...f.record,snapshotBasis:'devnet-qa-cutoff'}};
    const runtime=createCommunityDeliveryRuntime(f.options);await runtime.tick({preparationOnly:true});await runtime.tick();
    assert.equal(f.payments,0);assert.equal(f.preparations,0);
  }
});

test('an RPC outage stops further recipients and pauses both loops before a fresh retry',async()=>{
  for(const message of ['503 Service Unavailable','fetch failed','429 max usage reached']){
    const f=fixture();let time=100000,calls=0,fail=true;
    f.options.now=()=>time;
    f.ledger.communityDrops={[mint]:{...f.record,manifest:{leaves:[...f.record.manifest.leaves,...f.record.manifest.leaves]}}};
    f.options.deliveryFactory=()=>({pay:async()=>{calls++;if(fail)throw new Error(message);return {status:'finalized'};}});
    const runtime=createCommunityDeliveryRuntime(f.options);
    await runtime.tick();assert.equal(calls,1);assert.equal(f.ledger.communityDeliveryStatus.status,'degraded');
    assert.equal(f.ledger.communityDeliveryStatus.failures.length,1);
    await runtime.tick();await runtime.tick({preparationOnly:true});assert.equal(calls,1);
    assert.equal(f.ledger.communityPreparationStatus,undefined);
    time+=message.startsWith('429')?900000:60000;fail=false;
    await runtime.tick();assert.equal(calls,3);assert.equal(f.ledger.communityDeliveryStatus.status,'ready');
  }
});

test('batch pool scan notices a later migration and skips pools already older than the replay window',async()=>{
 const {createMigrationCandidateReader}=await import('../server/community-migration-discovery.mjs');
 const {PUMP_AMM_PROGRAM_ID}=await import('@pump-fun/pump-swap-sdk');
 const second=String(pair(127).publicKey),scan=createMigrationCandidateReader();let slot=1000,created=false,calls=0;
 const connection={getMultipleAccountsInfoAndContext:async(keys,options)=>{calls++;assert.equal(keys.length,2);
   assert.equal(options.commitment,'finalized');return {context:{slot},value:[{owner:PUMP_AMM_PROGRAM_ID},created?{owner:PUMP_AMM_PROGRAM_ID}:null]};}};
 assert.deepEqual([...await scan(connection,[mint,second])],[[mint,1000]]);
 slot+=257;created=true;assert.deepEqual([...await scan(connection,[mint,second])],[[second,1257]]);
 assert.equal(calls,2);
});
