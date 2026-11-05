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
    findMigration:async()=>{if(gate)await gate;return 'migration';},serviceFactory:()=>({prepare:async input=>{assert.equal(input.migrationSignature,'migration');preparations++;ledger.communityDrops={[mint]:record};return record;}}),
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
