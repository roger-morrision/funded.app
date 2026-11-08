import {featuredMetrics} from '../src/features/home/featured-metrics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {featuredTokens,FEATURED_WINDOW_MS} from '../src/features/home/featured-data.js';
import {featuredCardMarkup} from '../src/features/home/featured-view.js';
import {currentFeaturedTokens} from '../src/features/home/featured-placement.js';
import {createDirectoryRoutes} from '../server/routes/directory.mjs';
const now=Date.parse('2026-11-08T10:00:00Z'),mint=()=>Keypair.generate().publicKey.toBase58(),sig='2'.repeat(64);
const launch=(extra={})=>({mint:mint(),name:'Community coin',symbol:'FULLSYMBOL',onchainVerified:true,cluster:'devnet',blockTime:(now-1000)/1000,signature:sig,
  creatorLaunchBurn:{tier:'pro',status:'verified',receipt:{verified:true,atomicWithPumpLaunch:true,signature:sig}},...extra});
const listing=(extra={})=>({mint:mint(),name:'External coin',symbol:'EXT',onchainVerified:true,cluster:'devnet',status:'listed',signature:sig,listedAt:new Date(now-2000).toISOString(),...extra});
const select=(extra)=>featuredTokens({cluster:'devnet',now,...extra});

test('Featured includes every recent paid launch and manual listing, independent of market-feed limits',()=>{
  const launches=Array.from({length:45},()=>launch()),listings=[listing()];
  const result=select({launches,listings});assert.equal(result.length,46);
  assert.equal(result[0].label,'Pro promotion');assert.equal(result.at(-1).label,'Paid listing');
});
test('48-hour eligibility excludes exact expiry, future dates, unverified, unpaid and other networks',()=>{
  const invalid=[launch({blockTime:(now-FEATURED_WINDOW_MS)/1000}),launch({blockTime:now/1000+1}),
    launch({onchainVerified:false}),launch({creatorLaunchBurn:null}),launch({cluster:'mainnet-beta'}),launch({signature:'3'.repeat(64)})];
  assert.deepEqual(select({launches:invalid,listings:[listing({listedAt:'invalid'}),listing({onchainVerified:false}),listing({status:'pending'})]}),[]);
  assert.equal(select({launches:[launch({blockTime:(now-FEATURED_WINDOW_MS+1000)/1000})]}).length,1);
});
test('only active finalized boosts feature older tokens, until their exact expiry',()=>{
  const old=launch({blockTime:(now-FEATURED_WINDOW_MS-1000)/1000});
  const boost={mint:old.mint,cluster:'devnet',status:'finalized',packageId:'10x',multiplier:10,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString(),signature:sig};
  const result=select({launches:[old],boosts:[boost,boost]});assert.equal(result.length,1);assert.equal(result[0].label,'Paid boost');
  assert.equal(result[0].expiresAt,now+1000);
  assert.deepEqual(currentFeaturedTokens(result,now+1000),[]);
  assert.deepEqual(select({launches:[old],boosts:[{...boost,status:'pending'},{...boost,multiplier:999},{...boost,cluster:'mainnet-beta'},
    {...boost,expiresAt:new Date(now).toISOString()},{...boost,expiresAt:'invalid'},{...boost,expiresAt:undefined}]}),[]);
  const recent=launch();assert.equal(select({launches:[recent],listings:[listing({mint:recent.mint})]}).length,1);
});
test('featured endpoint returns the full verified placement projection and no payer data',async()=>{
  const coin=launch(),external=listing();let reads=0;
  // Route uses the current clock; keep the fixtures current without changing globals.
  coin.blockTime=Math.floor(Date.now()/1000)-1;external.listedAt=new Date(Date.now()-1000).toISOString();
  const handler=createDirectoryRoutes({solanaCluster:'devnet',store:{read:async()=>{reads++;return {launches:{[coin.mint]:coin},listings:{[external.mint]:external}};}},respond:(res,status,data)=>Object.assign(res,{status,data})});
  const res={};assert.equal(await handler({method:'GET'},res,new URL('https://test/api/home/featured')),true);
  assert.equal(reads,1);assert.equal(res.status,200);assert.equal(res.data.items.length,2);assert.equal(res.data.windowHours,48);
  assert.ok(res.data.items.every(item=>!('wallet' in item)&&!('payer' in item)));
});
test('cards preserve full identity, label paid placements and escape untrusted artwork and text',()=>{
  const item=select({launches:[launch({name:'<script>bad</script>',imageUri:'javascript:alert(1)'})]})[0];
  const html=featuredCardMarkup(item,'devnet');
  assert.ok(html.includes('FULLSYMBOL'));assert.ok(html.includes('Pro promotion'));assert.ok(html.includes('Token metrics'));assert.ok(!html.includes('Payment receipt'));assert.ok(!html.includes('Sponsored placement'));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));
});

test('Featured metrics use fresh caps and holder snapshots, label estimates, and preserve unknowns',()=>{
 const item={createdAt:now-7200000};
 const asset={verifiedAt:new Date(now-1000).toISOString(),complete:false,curveCapSol:10,marketActivityObservedAt:now-1000,priceChange24hPercent:12.5};
 const result=featuredMetrics(item,{asset,solUsd:100,now,holderSnapshot:{at:now-1000,count:8,coverage:'lower-bound'}});
 assert.equal(result.cap,'$1K');assert.equal(result.change,'≈+12.50%');assert.equal(result.age,'2h');assert.equal(result.holders,'≥8');
 const stale=featuredMetrics(item,{asset:{...asset,verifiedAt:new Date(now-300001).toISOString()},solUsd:100,now,holderSnapshot:{at:now-300001,count:8}});
 assert.equal(stale.cap,'—');assert.equal(stale.change,'—');assert.equal(stale.holders,'—');
 const unknown=featuredMetrics({},{asset:{...asset,complete:true,poolMarketCapSol:null},now,solUsd:100});
 assert.equal(unknown.cap,'—');assert.equal(unknown.age,'—');
 const zero=featuredMetrics(item,{asset:{...asset,curveCapSol:0,priceChange24hPercent:0},solUsd:100,now,holderSnapshot:{at:now,count:0,coverage:'complete'}});
 assert.equal(zero.cap,'$0');assert.equal(zero.holders,'0');assert.equal(zero.change,'≈0.00%');
});
test('Featured age is launch age, never placement or listing age',()=>{
 const old=launch({blockTime:(now-10*86400000)/1000});
 const boost={mint:old.mint,cluster:'devnet',status:'finalized',packageId:'10x',multiplier:10,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString(),signature:sig};
 assert.equal(select({launches:[old],boosts:[boost]})[0].createdAt,now-10*86400000);
 assert.equal(select({listings:[listing()]})[0].createdAt,null);
});

test('boost expiry falls back locally and on the server to a separate unexpired paid placement',()=>{
 const coin=launch({blockTime:(now-2000)/1000});
 const boost={mint:coin.mint,cluster:'devnet',status:'finalized',packageId:'10x',multiplier:10,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString(),signature:sig};
 for(const source of [{launches:[coin]}, {listings:[listing({mint:coin.mint})]}]) {
   const result=select({...source,boosts:[boost]});
   assert.equal(result[0].label,'Paid boost');
   const local=currentFeaturedTokens(result,now+1000);
   const server=featuredTokens({...source,boosts:[boost],cluster:'devnet',now:now+1000});
   assert.equal(local[0].label,source.launches?'Pro promotion':'Paid listing');
   assert.equal(local[0].label,server[0].label);
   assert.equal(local[0].expiresAt,now-2000+FEATURED_WINDOW_MS);
   assert.doesNotMatch(featuredCardMarkup(local[0],'devnet',now+1000),/Paid boost|home-featured-boost/);
   assert.deepEqual(currentFeaturedTokens(result,now-2000+FEATURED_WINDOW_MS),[]);
 }
});

test('an earlier active boost keeps the card until the last paid boost expires',()=>{
 const coin=launch({blockTime:(now-FEATURED_WINDOW_MS-1000)/1000});
 const first={mint:coin.mint,cluster:'devnet',status:'finalized',packageId:'10x',multiplier:10,startsAt:new Date(now-2000).toISOString(),expiresAt:new Date(now+5000).toISOString(),signature:sig};
 const second={...first,startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString(),signature:'3'.repeat(64)};
 const result=select({launches:[coin],boosts:[first,second]});
 assert.match(featuredCardMarkup(result[0],'devnet',now),/20×/);
 const remaining=currentFeaturedTokens(result,now+1000);
 assert.equal(remaining[0].label,'Paid boost');
 assert.match(featuredCardMarkup(remaining[0],'devnet',now+1000),/10×/);
 assert.deepEqual(currentFeaturedTokens(result,now+5000),[]);
});


test('Featured symbol shows summed active boosts and drops each package at expiry',()=>{
  const coin=launch();
  const pack=(packageId,multiplier,expiry,signature)=>({mint:coin.mint,cluster:'devnet',status:'finalized',packageId,multiplier,signature,
    startsAt:new Date(now-1000).toISOString(),expiresAt:new Date(expiry).toISOString()});
  const first=pack('10x',10,now+1000,sig),second=pack('30x',30,now+5000,'3'.repeat(64));
  const item=select({launches:[coin],boosts:[first,first,second,pack('500x',500,now-1,'4'.repeat(64)),{...first,status:'pending',signature:'5'.repeat(64)}, {...first,cluster:'mainnet-beta',signature:'6'.repeat(64)}]})[0];
  assert.equal(item.boost.packages.length,2);
  assert.match(featuredCardMarkup(item,'devnet',now),/40×/);
  assert.match(featuredCardMarkup(item,'devnet',now),/home-featured-symbol[\s\S]*FULLSYMBOL[\s\S]*home-featured-boost/);
  assert.match(featuredCardMarkup(item,'devnet',now+1000),/30×/);
  assert.doesNotMatch(featuredCardMarkup(item,'devnet',now+5000),/home-featured-boost/);
});
