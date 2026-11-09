import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {createPaymentHistoryReader} from '../server/payment-history.mjs';
import {v3ReferralPaymentSummary} from '../server/v3-referral-payment-summary.mjs';
import {loadFinalizedV3RewardFunding} from '../server/v3-reward-funding-proof.mjs';
import {createCreatorFeesRoutes} from '../server/routes/creator-fees.mjs';
import {registeredLaunchMetadata} from '../server/launch-registration-metadata.mjs';
import {verifyLaunchServiceFee} from '../server/launch-service-fee-proof.mjs';
import {pinnedMetadataUri,onchainMetadataUri} from '../metadata-publication.js';
import {isDevnetImageUri,isDevnetBannerUri,devnetLaunchMetadataUri} from '../devnet-metadata.js';
import {serverCoinIdentity} from '../src/features/coin/server-identity.js';
import {isAppPagePath} from '../server/page-routes.mjs';

const cluster='mainnet-beta',key=n=>new PublicKey(new Uint8Array(32).fill(n)).toBase58();

test('rebranding preserves finalized legacy metadata without accepting unrelated hosts or mints',async()=>{
  const mint=key(4),creatorWallet=key(3),record={cluster:'devnet',mint,creatorWallet,name:'Fixture',symbol:'FIX'};
  for(const host of ['richpad.fun','funded.vip']) {
    const uri=`https://${host}/m/${mint}`;
    assert.equal(devnetLaunchMetadataUri(mint,`https://${host}`),uri);
    assert.equal(await registeredLaunchMetadata({cluster:'devnet',record,inputUri:uri,
      proof:{cluster:'devnet',mint,feePayer:creatorWallet,name:'Fixture',symbol:'FIX',uri}}),uri);
    assert(isDevnetImageUri(`https://${host}/devnet-images/${mint}`,mint));
    assert(isDevnetBannerUri(`https://${host}/devnet-banners/${mint}`,mint));
  }
  for(const uri of [`https://richpad.fun.evil.example/m/${mint}`,`https://richpad.fun/m/${key(5)}`])
    await assert.rejects(registeredLaunchMetadata({cluster:'devnet',record,inputUri:uri,
      proof:{cluster:'devnet',mint,feePayer:creatorWallet,name:'Fixture',symbol:'FIX',uri}}));
});

test('new and historical token routes and verified social titles still resolve',()=>{
  for(const path of ['/rich','/rich/','/funded'])assert(isAppPagePath(path));
  assert.equal(isAppPagePath('/rich/unknown'),false);
  const mint=key(4);
  for(const brand of ['richpad.fun','funded.vip']) {
    const document={querySelector:selector=>({getAttribute:()=>selector==='link[rel="canonical"]'
      ?`https://richpad.fun/token/${mint}`:`Fixture (FIX) | ${brand}`})};
    assert.deepEqual(serverCoinIdentity(mint,document),{name:'Fixture',symbol:'FIX'});
    assert.equal(serverCoinIdentity(key(5),document),null);
  }
});
function fixture(kind='referral'){
  const mint=key(4),recipient=key(3),programId=key(5),authority=key(6),source='7'.repeat(64),signature='2'.repeat(64);
  const category=kind==='referral'?2:0;
  const route={verified:true,scope:'per-mint-v3',programId,router:authority,initialAuthority:authority,protocolSplit:{}};
  const payment={cluster,status:'finalized',collectionSignature:source,level:1,signature,mint,recipient,amount:'12',category,programId,balanceDeltaVerified:true};
  const state={launches:{[mint]:{mint,cluster,onchainVerified:true,creator:authority,creatorWallet:recipient,pumpFeeRoute:route}},
    collections:{[source]:{signature:source,mint,cluster,router:authority,scope:'per-mint-v3',programId,status:'collected',onchainVerified:true,collectedLamports:12}},
    v3Settlements:{[source]:{cluster,programId,status:'finalized',mint,collectionSignature:source,settlementSignature:'8'.repeat(64),referralUpline:[recipient],
      allocationPlan:{cluster,status:'allocated-not-funded',creatorDirected:{walletLamports:'12'},protocol:{referralLamports:['12','0','0']}}}},
    [kind==='referral'?'v3ReferralPayouts':'v3CreatorWalletPayout']:{[kind==='referral'?source+':1':source]:payment}};
  let proofCalls=0,reads=0;
  const connection={getGenesisHash:async()=>SOLANA_GENESIS[cluster],getTransaction:async()=>{reads++;return {transaction:{message:{accountKeys:[authority]}}};}};
  const proof={cluster,signature,recipient,mint,programId,category,amount:'12',balanceDeltaVerified:true,slot:123,withdrawal:key(9),feePayer:authority,feeLamports:5000,blockTime:123456};
  const loadFunding=async options=>{proofCalls++;assert.equal(options.cluster,cluster);return proof;};
  return {state,payment,connection,proof,loadFunding,mint,programId,source,proofCalls:()=>proofCalls,reads:()=>reads};
}
function history(f){return createPaymentHistoryReader({v3Only:true,cluster,readEvidence:async()=>({}),rewardsStore:{read:async()=>({})},
  store:{read:async()=>f.state},connectionFactory:()=>f.connection,officialGenesis:async()=>SOLANA_GENESIS[cluster],
  loadReferralPayment:f.loadFunding,loadCreatorPayment:f.loadFunding})();}

test('Mainnet payment history carries the network into creator and referral receipt verification',async()=>{
  for(const kind of ['creator','referral']){
    const f=fixture(kind),result=await history(f);
    assert.equal(result.verifiedPayouts.length,1);assert.equal(result.verifiedPayouts[0].source,kind==='creator'?'v3-creator-wallet':'v3-referral');
    assert.equal(f.proofCalls(),1);
  }
});
test('foreign or unlabelled Mainnet payouts, settlements and allocations never become verified history',async()=>{
  for(const kind of ['creator','referral'])for(const target of ['payment','settlement','allocation'])for(const wrong of ['devnet',undefined]){
    const f=fixture(kind),settlement=f.state.v3Settlements[f.source];
    const row=target==='payment'?f.payment:target==='settlement'?settlement:settlement.allocationPlan;
    row.cluster=wrong;
    assert.equal((await history(f)).verifiedPayouts.length,0,`${kind} ${target} ${wrong}`);
    assert.equal(f.proofCalls(),0);
  }
});
test('Mainnet history rejects a foreign RPC and foreign returned proofs',async()=>{
  const f=fixture();f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  assert.equal((await history(f)).verifiedPayouts.length,0);assert.equal(f.reads(),0);
  const g=fixture('creator');g.proof.cluster='devnet';assert.equal((await history(g)).verifiedPayouts.length,0);
  let reads=0;
  const proof=await loadFinalizedV3RewardFunding({cluster,connection:{getGenesisHash:async()=>SOLANA_GENESIS.devnet,getTransaction:async()=>{reads++;}}});
  assert.equal(proof,null);assert.equal(reads,0);
});
test('referral proof cache is isolated by network and full recorded payment identity',async()=>{
  const f=fixture(),cache=new Map();
  assert.equal((await v3ReferralPaymentSummary({...f,cluster,proofCache:cache})).payoutCount,1);
  f.payment.amount='13';
  assert.equal((await v3ReferralPaymentSummary({...f,cluster,proofCache:cache})).payoutCount,0);
  assert.equal(f.proofCalls(),1);
});
test('Mainnet creator-fee dashboard reads the correct chain and excludes foreign collections and payout states',async()=>{
  const f=fixture('creator');f.state.collections.foreign={...f.state.collections[f.source],cluster:'devnet',signature:'foreign'};
  let response,balanceReads=0;
  const route=createCreatorFeesRoutes({store:{read:async()=>f.state},solanaCluster:cluster,route:(path,method,re)=>path.match(re)?.[1],
    solanaRpcUrl:'https://unused.invalid',respond:(_res,status,data)=>{response={status,data};},
    env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:f.programId},connectionFactory:()=>f.connection,readBalance:async()=>{balanceReads++;return 12n;}});
  const url=new URL(`https://example.invalid/api/tokens/${f.mint}/fee-activity`);
  await route({method:'GET'},{},url);assert.equal(response.status,200);assert.equal(response.data.overview.collections.length,1);
  assert.equal(response.data.overview.collections[0].creatorWalletPayoutVerified,true);
  f.payment.cluster='devnet';await route({method:'GET'},{},url);
  assert.equal(response.data.overview.collections[0].creatorWalletPayoutVerified,false);
  f.connection.getGenesisHash=async()=>SOLANA_GENESIS.devnet;
  await route({method:'GET'},{},url);assert.equal(response.data.overview.pump.status,'unavailable');assert.equal(balanceReads,2);
});
test('Mainnet registration requires matching signed, durable, publicly verified metadata',async()=>{
  const uri=pinnedMetadataUri('b'+'a'.repeat(30)),mint=key(4),payer=key(3);
  const record={cluster,mint,creatorWallet:payer,name:'Fixture',symbol:'FIX',pinnedMetadata:{uri}};
  const proof={cluster,mint,feePayer:payer,name:'Fixture',symbol:'FIX',uri:onchainMetadataUri(uri)};
  let calls=0;
  const verifyPublication=async()=>{calls++;return {verified:true,uri};};
  assert.equal(await registeredLaunchMetadata({proof,record,cluster,verifyPublication}),proof.uri);
  for(const bad of [{...record,cluster:'devnet'},{...record,mint:key(9)},{...record,pinnedMetadata:null},null])
    await assert.rejects(registeredLaunchMetadata({proof,record:bad,cluster,verifyPublication}));
  assert.equal(calls,1);
  await assert.rejects(registeredLaunchMetadata({proof,record,cluster,verifyPublication:async()=>({verified:false,uri})}),/could not be verified/);
  assert.throws(()=>verifyLaunchServiceFee({cluster,quote:{cluster:'devnet',genesisHash:SOLANA_GENESIS.devnet}}),/network/);
  assert.throws(()=>verifyLaunchServiceFee({cluster,quote:{}}),/network/);
});
