import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createLaunchQuoteRoutes} from '../server/routes/launch-quotes.mjs';
import {launchTierQuoteCurrent,LAUNCH_TIER_USD} from '../launch-tier-quote.js';
import {verifyAtomicLaunchPromotion,verifyPumpLaunch} from '../server/launch-verification.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';

function fixture(cluster='mainnet-beta'){
 const mint=Keypair.generate().publicKey.toBase58(),payer=Keypair.generate().publicKey.toBase58(),state={};let result,writes=0;
 const pricing={cluster,genesisHash:SOLANA_GENESIS[cluster],fundedMint:mint,pool:Keypair.generate().publicKey.toBase58(),slot:11,tokenPriceUsd:1,source:'verified-pump-swap-pool'};
 const store={read:async()=>state,update:async fn=>{writes++;return fn(state);},chargeRpcRate:async()=>true};
 const invoke=async(overrides={},method='POST')=>{
  const handler=createLaunchQuoteRoutes({store,solanaCluster:cluster,fundedTokenMint:mint,env:{CORS_ORIGIN:'https://fixture.invalid'},
   body:async()=>({tier:'pro',payer}),clientKey:()=>'',id:()=>`launch_tier_${Date.now()}_0123456789abcdef`,
   currentLaunchTierPricing:async()=>pricing,respond:(_r,status,data)=>{result={status,data};},...overrides});
  await handler({method,headers:{origin:'https://fixture.invalid'}},{},new URL('https://fixture.invalid/api/launch-tier-quote'));return result;
 };
 return{mint,payer,state,pricing,store,invoke,writes:()=>writes};
}
test('saved paid launch quote preserves selected network through client validation',async()=>{
 for(const cluster of ['devnet','mainnet-beta']){
  const f=fixture(cluster),result=await f.invoke();assert.equal(result.status,201);
  assert.deepEqual(f.state.launchTierQuotes[result.data.id],result.data);
  assert.equal(result.data.genesisHash,SOLANA_GENESIS[cluster]);
  assert(launchTierQuoteCurrent(result.data,{cluster,payer:f.payer,mint:f.mint,tier:'pro'}));
  assert.equal(launchTierQuoteCurrent(result.data,{cluster:cluster==='devnet'?'mainnet-beta':'devnet'}),false);
 }
});
test('foreign pricing network, genesis or mint cannot produce a saved quote',async()=>{
 for(const changes of [{cluster:'devnet'},{genesisHash:SOLANA_GENESIS.devnet},{fundedMint:Keypair.generate().publicKey.toBase58()},
  {cluster:undefined,genesisHash:undefined}]){
  const f=fixture();Object.assign(f.pricing,changes);
  assert.equal((await f.invoke()).status,503);assert.equal((await f.invoke({},'GET')).status,503);assert.equal(f.writes(),0);
 }
});
test('lost quote persistence returns unavailable before authorizing a burn',async()=>{
 const f=fixture(),result=await f.invoke({store:{...f.store,update:async()=>{}}});
 assert.equal(result.status,503);assert.match(result.data.error,/No burn/);
});
test('Mainnet never accepts an unlabelled or Devnet promotion quote',()=>{
 const quote={id:'launch_tier_123_0123456789abcdef',tier:'pro',amountTokens:1,usd:LAUNCH_TIER_USD.pro,
  createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+10000).toISOString()};
 assert.equal(launchTierQuoteCurrent(quote,{cluster:'mainnet-beta'}),false);
 assert.equal(launchTierQuoteCurrent(quote,{cluster:'devnet'}),true);
 for(const row of [null,quote,{...quote,cluster:'devnet',genesisHash:SOLANA_GENESIS.devnet}])
  assert.throws(()=>verifyAtomicLaunchPromotion({cluster:'mainnet-beta',claim:{tier:'pro'},quote:row}),/network/);
});
test('Mainnet creation proof checks chain before reading mint or transaction',async()=>{
 let reads=0;const connection={getGenesisHash:async()=>SOLANA_GENESIS.devnet,getTransaction:async()=>{reads++;},getAccountInfo:async()=>{reads++;}};
 await assert.rejects(()=>verifyPumpLaunch({cluster:'mainnet-beta',connection}),/network/);assert.equal(reads,0);
});
