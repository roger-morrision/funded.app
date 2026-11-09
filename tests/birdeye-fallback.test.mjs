import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketProviders} from '../server/market-providers.mjs';
import {createBirdeyeMarketFallback} from '../server/birdeye-market-fallback.mjs';
import {createTokenMarketRoutes} from '../server/routes/token-market.mjs';
import {renderIndexedMarket} from '../src/features/coin/indexed-market.js';
import {SOLANA_GENESIS} from '../solana-network.js';

const mint='So11111111111111111111111111111111111111112',cluster='mainnet-beta';
test('Birdeye summaries are network-bound, nullable, cached and deduplicated',async()=>{
  let calls=0,now=100000;
  const fetchBirdeye=async()=>{calls++;return {configured:true,data:{address:mint,price:2,v24hUSD:30,holder:0,marketCap:null,trade24h:2,priceChange24hPercent:-3}};};
  const read=createBirdeyeMarketFallback({fetchBirdeye,cluster,now:()=>now});
  assert.equal(await createBirdeyeMarketFallback({fetchBirdeye,cluster:'devnet'})(mint),null);
  const [a,b]=await Promise.all([read(mint),read(mint)]);
  assert.equal(calls,1);assert.equal(a,b);assert.equal(a.holders,0);assert.equal(a.marketCapUsd,null);
  assert.equal(a.volume24hUsd,30);assert.equal(a.volume24hSol,undefined);assert.equal(a.recentTrades,undefined);
  assert.equal(a.priceChangePercent,-3);assert.equal(a.displayOnly,true);
  now+=60001;await read(mint);assert.equal(calls,2);
  assert.equal(await createBirdeyeMarketFallback({fetchBirdeye,cluster})('other-mint'),null);
});
test('Birdeye outages use a negative cache and never return expired data',async()=>{
  let now=0,calls=0;
  const read=createBirdeyeMarketFallback({cluster,now:()=>now,fetchBirdeye:async()=>{
    calls++;if(calls>1)throw Error('private upstream error');return {configured:true,data:{address:mint,price:2}};
  }});
  assert.ok(await read(mint));now=60001;assert.equal(await read(mint),null);
  assert.equal(await read(mint),null);assert.equal(calls,2);
});
test('Provider restricts key destination, suppresses upstream messages and backs off',async()=>{
  let calls=0,now=0;
  const options={birdeyeApiKey:'test-key',birdeyeBaseUrl:'https://public-api.birdeye.so',birdeyeChain:'solana',birdeyeTimeoutMs:100,
    now:()=>now,fetch:async(url,init)=>{calls++;assert.equal(init.headers['X-API-KEY'],'test-key');assert.equal(init.redirect,'error');
      return {ok:false,status:429,json:async()=>({success:false,message:'sensitive details'})};}};
  const {fetchBirdeye}=createMarketProviders(options);
  await assert.rejects(fetchBirdeye('/defi/token_overview'),/^Error: Birdeye request failed \(429\)\.$/);
  await assert.rejects(fetchBirdeye('/defi/token_overview'),/cooling down/);assert.equal(calls,1);
  await assert.rejects(createMarketProviders({...options,birdeyeBaseUrl:'https://evil.example'}).fetchBirdeye('/defi/price'),/Invalid/);
  assert.equal(calls,1);
});
test('Primary RPC failure falls back without recording indexed data as chain proof; primary recovers',async()=>{
  let healthy=false,fallbackCalls=0,writes=0,response;
  const fallback={mint,cluster,source:'birdeye',displayOnly:true,coverage:'indexed',observedAt:new Date().toISOString(),volume24hUsd:20};
  const build=()=>createTokenMarketRoutes({route:(path,method,re)=>re.exec(path)?.[1],clientKey:()=> 'test',solanaRpcUrl:'https://example.test',solanaCluster:cluster,
    store:{chargeRpcRate:async()=>true,readMarketActivity:async()=>null,writeMarketActivity:async()=>{writes++;}},
    respond:(res,status,data)=>{response={status,data};},
    makeMarketConnection:()=>({getGenesisHash:async()=>{if(!healthy)throw Error('RPC offline');return SOLANA_GENESIS[cluster];}}),
    readMarketActivity:async()=>({coverage:'complete',volume24hSol:1}),readRankingQuote:async()=>null,
    readMarketFallback:async()=>{fallbackCalls++;return fallback;}});
  const req={method:'GET'},url=new URL(`https://app.test/api/tokens/${mint}/market-activity`);
  const handler=build();await handler(req,{},url);assert.equal(response.status,200);assert.equal(response.data,fallback);assert.equal(writes,0);
  await handler(req,{},url);assert.equal(fallbackCalls,1);
  healthy=true;await build()(req,{},url);assert.equal(response.data.source,'confirmed-pump-trade-events');assert.equal(writes,1);assert.equal(fallbackCalls,1);
});
test('Fallback renderer preserves unavailable values and never creates trading state',()=>{
  const fields={},app={EXPLORE_CLUSTER:cluster,setCoinField:(k,v)=>fields[k]=v,formatUsd:n=>`$${n}`};
  const data={mint,cluster,source:'birdeye',displayOnly:true,observedAt:new Date(100000).toISOString(),priceUsd:2,marketCapUsd:null,holders:0};
  assert.equal(renderIndexedMarket(app,data,mint,100001),true);assert.equal(fields['#coin-market-cap'],'—');assert.equal(fields['#coin-holder-count'],'0');
  assert.equal(app.coinTradeEstimate,undefined);assert.equal(app.coinSolUsdValues,undefined);
  assert.equal(renderIndexedMarket(app,data,mint,160001),false);
  assert.equal(renderIndexedMarket({...app,EXPLORE_CLUSTER:'devnet'},data,mint,100001),false);
});
