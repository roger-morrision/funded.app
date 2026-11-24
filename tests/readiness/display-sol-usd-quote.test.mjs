import test from 'node:test';
import assert from 'node:assert/strict';
import {createDisplaySolUsdQuoteReader} from '../../server/display-sol-usd-quote.mjs';
import {createServiceStatusRoutes} from '../../server/routes/service-status.mjs';

const start=Date.parse('2026-11-24T00:00:00Z');
const primaryQuote=at=>({priceUsd:72,source:'coingecko',fetchedAt:new Date(at).toISOString()});
const spot=(data={amount:'72.03',base:'SOL',currency:'USD'},headers={})=>({ok:true,headers:new Headers(headers),json:async()=>({data})});

test('display requests share a fresh primary quote without contacting another provider',async()=>{
 let calls=0;const read=createDisplaySolUsdQuoteReader({now:()=>start,readPrimary:async()=>{calls++;return primaryQuote(start);},
  fetchImpl:async()=>{throw new Error('Fallback must not be contacted');}});
 const values=await Promise.all(Array.from({length:12},()=>read()));
 assert.equal(calls,1);assert(values.every(q=>q.source==='coingecko'&&q.priceUsd===72));
 values[0].priceUsd=1;assert.equal((await read()).priceUsd,72);
});

test('primary outage produces one coalesced validated display fallback',async()=>{
 let primaryCalls=0,fallbackCalls=0;
 const read=createDisplaySolUsdQuoteReader({now:()=>start,readPrimary:async()=>{primaryCalls++;return null;},
  fetchImpl:async(url,options)=>{fallbackCalls++;assert.equal(url,'https://api.coinbase.com/v2/prices/SOL-USD/spot');
   assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);
   return spot();}});
 const values=await Promise.all(Array.from({length:12},()=>read()));
 assert.equal(primaryCalls,1);assert.equal(fallbackCalls,1);
 assert(values.every(q=>q.source==='coinbase'&&q.priceUsd===72.03&&q.fetchedAt===new Date(start).toISOString()));
});

test('a slow primary cannot hold the public display past its fallback budget',async()=>{
 const read=createDisplaySolUsdQuoteReader({now:()=>start,primaryWaitMs:1,readPrimary:()=>new Promise(()=>{}),fetchImpl:async()=>spot()});
 assert.equal((await read()).source,'coinbase');
});

test('an expired display quote is not returned during an outage and primary recovery bypasses fallback cooldown',async()=>{
 let at=start,available=true,recovered=false,calls=0;
 const read=createDisplaySolUsdQuoteReader({now:()=>at,readPrimary:async()=>recovered?primaryQuote(at):null,
  fetchImpl:async()=>{calls++;if(!available)throw new Error('provider unavailable');return spot();}});
 assert.equal((await read()).source,'coinbase');available=false;at+=30_000;
 assert.equal(await read(),null);assert.equal(await read(),null);assert.equal(calls,2);
 recovered=true;assert.equal((await read()).source,'coingecko');assert.equal(calls,2);
});

for(const data of [
 {amount:'72',base:'BTC',currency:'USD'}, {amount:'72',base:'SOL',currency:'USDT'},
 ...['0','-1','NaN','Infinity','1e6',''].map(amount=>({amount,base:'SOL',currency:'USD'})),
])test('display fallback rejects wrong pairs and invalid amounts: '+JSON.stringify(data),async()=>{
 const read=createDisplaySolUsdQuoteReader({now:()=>start,readPrimary:async()=>null,fetchImpl:async()=>spot(data)});
 assert.equal(await read(),null);
});

for(const headers of [
 {age:'60'},{age:'invalid'},{date:new Date(start-60_000).toUTCString()},
 {date:new Date(start+10_000).toUTCString()},{date:'invalid'},
])test('display fallback rejects stale or invalid upstream freshness: '+JSON.stringify(headers),async()=>{
 const read=createDisplaySolUsdQuoteReader({now:()=>start,readPrimary:async()=>null,fetchImpl:async()=>spot(undefined,headers)});
 assert.equal(await read(),null);
});

test('display caching never extends the original upstream timestamp',async()=>{
 let at=start,calls=0;
 const read=createDisplaySolUsdQuoteReader({now:()=>at,readPrimary:async()=>null,
  fetchImpl:async()=>{calls++;return spot(undefined,{date:new Date(start-59_000).toUTCString()});}});
 assert.equal((await read()).fetchedAt,new Date(start-59_000).toISOString());
 at+=1000;assert.equal(await read(),null);assert.equal(calls,2);
});

test('stale primary and failed HTTP fallback cannot produce a display price',async()=>{
 let calls=0;
 const read=createDisplaySolUsdQuoteReader({now:()=>start,readPrimary:async()=>primaryQuote(start-60_000),
  fetchImpl:async()=>{calls++;return{ok:false,json:async()=>({data:{amount:'72',base:'SOL',currency:'USD'}})};}});
 assert.equal(await read(),null);assert.equal(await read(),null);assert.equal(calls,1);
});

test('public price route uses its display dependency without invoking the financial quote dependency',async()=>{
 let financialCalls=0,displayCalls=0,response;
 const {handleServiceStatus}=createServiceStatusRoutes({env:{},solanaCluster:'devnet',
  readSolUsdQuote:async()=>{financialCalls++;throw new Error('Financial reader must not be selected here');},
  readDisplaySolUsdQuote:async()=>{displayCalls++;return{...primaryQuote(start),source:'coinbase'};},
  respond:(_res,status,body)=>{response={status,body};}});
 await handleServiceStatus({method:'GET'},{},new URL('https://example.test/api/market/sol-usd'));
 assert.equal(displayCalls,1);assert.equal(financialCalls,0);assert.equal(response.status,200);assert.equal(response.body.source,'coinbase');
});

test('public price route remains unavailable when no fresh display quote exists',async()=>{
 let response;
 const {handleServiceStatus}=createServiceStatusRoutes({env:{},solanaCluster:'devnet',readDisplaySolUsdQuote:async()=>null,
  respond:(_res,status,body)=>{response={status,body};}});
 await handleServiceStatus({method:'GET'},{},new URL('https://example.test/api/market/sol-usd'));
 assert.equal(response.status,503);assert.match(response.body.error,/unavailable/);
});
