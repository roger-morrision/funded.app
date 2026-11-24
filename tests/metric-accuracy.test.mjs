import test from 'node:test';
import assert from 'node:assert/strict';
import {metricNumber,completeTradeCount,marketValuation} from '../market-metrics.js';
import {createFreeMarketData} from '../server/free-market-data.mjs';
import {summarizeDexPairs} from '../server/external-token-market.mjs';
import {createHolderCountReader} from '../server/holder-count.mjs';
import {cachedOverview,mergeOverviewMetrics,supplyFacts} from '../server/overview-metrics.mjs';
const mint='38M2z4UCfZEkUHFzD48vhKQhFhNyRGto8pZbLjNipump';
test('missing metrics remain unknown while genuine zero counts remain zero',()=>{
  for(const value of [null,undefined,'',false,NaN,Infinity])assert.equal(metricNumber(value),null);
  for(const [buy,sell] of [[null,null],[10,null],[undefined,3],[-1,2],[1.5,2]])assert.equal(completeTradeCount(buy,sell),null);
  assert.equal(completeTradeCount(0,0),0);assert.equal(completeTradeCount(10,2),12);
});
test('both DEX readers preserve FDV separately from missing market cap',async()=>{
  const pair={chainId:'solana',baseToken:{address:mint,name:'Fixture'},marketCap:null,fdv:1000000,liquidity:{usd:100}};
  const free=createFreeMarketData({fetch:async()=>Response.json([pair])});
  for(const data of [(await free.dexTokens([mint])).get(mint),summarizeDexPairs([pair],mint)]){
    assert.equal(data.marketCapUsd,null);assert.equal(data.fdvUsd,1000000);
    assert.deepEqual(marketValuation(data),{value:1000000,label:'FDV'});
  }
  assert.equal(summarizeDexPairs([pair],mint).trades24h,null);
  assert.deepEqual(marketValuation({marketCapUsd:0,fdvUsd:100}),{value:0,label:'Market cap'});
});
test('provider metadata refresh does not return a ten-minute-old holder count',async()=>{
  let now=0,calls=0;
  const free=createFreeMarketData({now:()=>now,fetch:async()=>Response.json({data:{attributes:{holders:{count:++calls}}}})});
  assert.equal((await free.geckoTokenInfo(mint)).holders.count,1);
  now=59000;assert.equal((await free.geckoTokenInfo(mint)).holders.count,1);
  now=61000;assert.equal((await free.geckoTokenInfo(mint)).holders.count,2);
});
test('holder refresh is coalesced, accepts zero and marks failed refreshes stale without changing timestamps',async()=>{
  let now=0,count=3752,calls=0,fail=false;
  const reader=createHolderCountReader({now:()=>now,free:{geckoTokenInfo:async()=>{calls++;if(fail)throw Error('offline');return {holders:{count}};},jupToken:async()=>null},fetchBirdeye:async()=>null});
  const initial=await Promise.all([reader(mint),reader(mint)]);assert.equal(calls,1);assert.equal(initial[0].holderCount,3752);
  now=61000;count=3852;const next=await reader(mint);assert.equal(next.holderCount,3852);assert.equal(next.holderCountStale,false);
  now=122000;fail=true;const stale=await reader(mint);assert.equal(stale.holderCount,3852);assert.equal(stale.holderCountStale,true);assert.equal(stale.holderCountCheckedAt,next.holderCountCheckedAt);
  now+=16000;fail=false;count=0;assert.equal((await reader(mint)).holderCount,0);
});
test('legacy FDV and assumed burns cannot survive fresh or fallback cache merges',()=>{
  const legacy={marketCapUsd:1000000,burnedTokens:500000000,burnedPercent:50,initialSupplyTokens:1000000000,holders:999,windows:{'24h':{buys:50}}};
  const fallback=cachedOverview(legacy);assert.equal(fallback.marketCapUsd,null);assert.equal(fallback.burnedTokens,null);
  const fresh=mergeOverviewMetrics(legacy,{marketCapUsd:null,fdvUsd:800000},supplyFacts(500000000),{holderCount:null,holderCountStale:true});
  for(const key of ['marketCapUsd','burnedTokens','burnedPercent','initialSupplyTokens','holders','buyCount24h','sellCount24h','windows'])assert.equal(fresh[key],null,key);
  assert.equal(fresh.supplyTokens,500000000);assert.equal(fresh.burnedSupplyVerified,false);
});
