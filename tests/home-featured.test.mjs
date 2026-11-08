import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {featuredTokens,FEATURED_WINDOW_MS} from '../src/features/home/featured-data.js';
import {featuredCardMarkup} from '../src/features/home/featured-view.js';
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
test('recent finalized boosts feature older tokens once, without claiming the boost itself remains active',()=>{
  const old=launch({blockTime:(now-FEATURED_WINDOW_MS-1000)/1000});
  const boost={mint:old.mint,cluster:'devnet',status:'finalized',packageId:'10x',multiplier:10,startsAt:new Date(now-24*3600000).toISOString(),signature:sig};
  const result=select({launches:[old],boosts:[boost,boost]});assert.equal(result.length,1);assert.equal(result[0].label,'Paid boost');
  assert.deepEqual(select({launches:[old],boosts:[{...boost,status:'pending'},{...boost,multiplier:999},{...boost,cluster:'mainnet-beta'}]}),[]);
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
  assert.ok(html.includes('FULLSYMBOL'));assert.ok(html.includes('Sponsored placement'));assert.ok(html.includes('?cluster=devnet'));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));
});
