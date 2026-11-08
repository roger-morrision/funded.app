import test from 'node:test';
import assert from 'node:assert/strict';
import {top100Records,rankTop100} from '../src/features/explore/top100-model.js';
import {createNavigationController} from '../src/app/controllers/navigation.js';
import {loadTop100Feed,readAccountBatches} from '../src/features/explore/top100-feed.js';

const mint = 'A'.repeat(32), other = 'B'.repeat(32), now = Date.now();
const metrics = caps => ({cluster:'devnet',scope:'retained-visible-posts-24h',observedAt:now,items:{},
  growth:{scope:'net-change-24h',observedAt:now,items:Object.fromEntries(Object.entries(caps).map(([mint,delta])=>[mint,{marketCapUsd:{delta,from:now-86400000,to:now}}]))}});
test('Featured gives verified paid listings and launch promotions priority without changing market ranks', () => {
  const listed='C'.repeat(32), unpaid='D'.repeat(32), signature='2'.repeat(64);
  const policies=[{mint,cluster:'devnet',onchainVerified:true,signature,
    creatorLaunchBurn:{tier:'pro',status:'verified',receipt:{verified:true,atomicWithPumpLaunch:true,signature}}}];
  const rows=top100Records([
    {address:mint,curveCapSol:2},
    {address:other,curveCapSol:100},
    {address:listed,listingPayment:{verified:true,signature}},
    {address:unpaid,curveCapSol:3,paidPriority:true,listingPayment:{verified:false,signature}},
  ],{policies,solUsd:1,now,community:metrics({[mint]:2,[other]:100,[unpaid]:3})});
  assert.deepEqual(rankTop100(rows).rows.map(row=>row.mint),[listed,mint,other,unpaid]);
  assert.deepEqual(rankTop100(rows,{sort:'market-cap'}).rows.map(row=>row.mint),[other,unpaid,mint]);
  assert.deepEqual(rankTop100(rows,{tier:'listed'}).rows.map(row=>row.mint),[listed]);
  assert.equal(rows.find(row=>row.mint===unpaid).paidPriority,false);
  assert.equal(rankTop100(rows).rows[0].capUsd,null);
  for(const invalid of [{...policies[0],cluster:'mainnet-beta'},{...policies[0],onchainVerified:false},
    {...policies[0],creatorLaunchBurn:{...policies[0].creatorLaunchBurn,status:'pending'}}]) {
    assert.equal(top100Records([{address:mint}],{policies:[invalid],now})[0].paidPriority,false);
  }
});
test('Featured priority affects the 100-token cutoff; each group remains deterministic', () => {
  const rows=Array.from({length:110},(_,i)=>({mint:String(i).padStart(4,'0'),capUsd:110-i,capGrowthUsd:110-i,paidPriority:false}));
  rows[109].paidListing=true;
  const featured=rankTop100(rows).rows;
  assert.equal(featured.length,100);assert.equal(featured[0].mint,'0109');
  assert.equal(featured[1].mint,'0000');assert.equal(featured.at(-1).mint,'0098');
  assert.equal(rankTop100(rows,{sort:'market-cap'}).rows[0].mint,'0000');
  assert.equal(rankTop100(rows,{sort:'market-cap'}).rows.at(-1).mint,'0099');
});
test('stacked boosts raise Featured priority only during each package lifetime', () => {
  const listed='C'.repeat(32), signature='2'.repeat(64);
  const pack=(packageId,multiplier,end,start=now-1000)=>({packageId,multiplier,startsAt:new Date(start).toISOString(),expiresAt:new Date(end).toISOString()});
  const boosts={
    [mint]:{packages:[pack('50x',50,now+1000),pack('10x',10,now+10000),pack('500x',500,now+50000,now+40000)]},
    [other]:{packages:[pack('30x',30,now+5000)]},
  };
  const assets=[{address:mint,curveCapSol:1},{address:other,curveCapSol:100},
    {address:listed,curveCapSol:500,listingPayment:{verified:true,signature}}];
  const rows=at=>top100Records(assets,{boosts,solUsd:1,now:at});
  assert.deepEqual(rankTop100(rows(now)).rows.map(row=>row.mint),[mint,other,listed]);
  assert.equal(rows(now)[0].boost,60);
  assert.equal(rows(now)[0].boostNextExpiry,now+1000);
  assert.equal(rows(now)[0].boostExpiresAt,now+10000);
  assert.deepEqual(rankTop100(rows(now+1000)).rows.map(row=>row.mint),[other,mint,listed]);
  assert.equal(rows(now+1000)[0].boost,10);
  assert.deepEqual(rankTop100(rows(now+5000)).rows.map(row=>row.mint),[mint,listed,other]);
  assert.deepEqual(rankTop100(rows(now+10000)).rows.map(row=>row.mint),[listed,mint,other]);
  assert.equal(rows(now+10000)[0].boostExpiresAt,null);
  assert.equal(rankTop100(rows(now),{sort:'market-cap'}).rows.length,0);
});
test('Top 100 keeps organic ranking separate from active sponsored boosts', () => {
  const records = top100Records([{address:mint,curveCapSol:5},{address:other,curveCapSol:10}],
    {solUsd:100,now,community:metrics({[mint]:5,[other]:10}),boosts:{[mint]:{multiplier:50,expiresAt:new Date(now+60000).toISOString()}}});
  assert.equal(rankTop100(records,{sort:'market-cap'}).rows[0].mint,other);
  assert.equal(rankTop100(records,{sort:'boosted'}).rows[0].mint,mint);
  assert.equal(rankTop100(top100Records(records,{now:now+60001,boosts:{[mint]:{multiplier:50,expiresAt:new Date(now+60000).toISOString()}}}),{sort:'boosted'}).rows.length,0);
});
test('missing metrics, stale activity, migrated curve reserves and listing age are not invented', () => {
  const rows = top100Records([{address:mint,complete:true,curveCapSol:500,listingPayment:{verified:true},createdTimestamp:now/1000-3600,
    volume24hSol:20,tradeCount24h:9,marketActivityObservedAt:now-300001},{address:other,curveCapSol:0}],{solUsd:100,now});
  assert.equal(rows[0].capUsd,null);assert.equal(rows[0].volumeUsd,null);assert.equal(rows[0].trades,null);assert.equal(rows[0].ageHours,null);
  assert.equal(rankTop100(rows,{sort:'market-cap'}).rows.length,0); // Current cap is not 24h growth.
  assert.equal(rankTop100(rows,{sort:'volume'}).rows.length,0);
});
test('rank ceiling, deterministic ties and filters preserve global rank', () => {
  const rows=Array.from({length:350},(_,i)=>({mint:String(i).padStart(4,'0'),name:`Coin ${i}`,symbol:`C${i}`,capUsd:350-i,capGrowthUsd:350-i,volumeUsd:350-i,trades:350-i,boost:350-i,stage:'curve',tier:'pro',ageHours:2}));
  for (const sort of ['market-cap','volume','trades','boosted']) {
    const result=rankTop100(rows,{sort});
    assert.equal(result.rows.length,100);assert.equal(result.rows.at(-1).rank,100);
  }
  assert.equal(rankTop100(rows,{query:'C100'}).rows.length,0);
  assert.equal(rankTop100(rows,{query:'C40'}).rows[0].rank,41);
  assert.equal(rankTop100(rows,{stage:'migrated'}).rows.length,0);
  assert.equal(rankTop100(rows,{tier:'standard'}).rows.length,0);
  assert.equal(rankTop100(rows,{minCap:400}).rows.length,0);
  assert.equal(rankTop100(rows,{maxAge:1}).rows.length,0);
  assert.deepEqual(rankTop100([{mint:'B',capUsd:1},{mint:'A',capUsd:1}]).rows.map(r=>r.mint),['A','B']);
});
test('directory pagination goes beyond 40 and reports incomplete coverage', async () => {
  const calls=[];
  const request=async url=>{calls.push(url);const offset=Number(new URL(url,'http://test').searchParams.get('offset'));
    return {available:true,data:{cluster:'devnet',total:120,items:Array.from({length:Math.min(50,120-offset)},(_,i)=>({mint:`mint${offset+i}`}))}};};
  const full=await loadTop100Feed(request);assert.equal(full.data.items.length,120);assert.equal(full.data.directoryComplete,true);assert.equal(calls.length,3);
  const partial=await loadTop100Feed(request,{maxPages:1});assert.equal(partial.data.directoryComplete,false);
  const failed=await loadTop100Feed(async url=>url.includes('offset=0&')?request(url):{available:false});assert.equal(failed.available,false);
});
test('RPC batches respect the 100 account limit and preserve ordering', async () => {
  const keys=Array.from({length:602},(_,i)=>i),sizes=[];
  const result=await readAccountBatches({getMultipleAccountsInfo:async batch=>{sizes.push(batch.length);return batch;}},keys);
  assert.deepEqual(result,keys);assert.deepEqual(sizes,[100,100,100,100,100,100,2]);
});

test('direct Top 100 links resolve before runtime navigation bindings initialize', () => {
  const prior=globalThis.location;
  try {globalThis.location={hash:'#top100',pathname:'/',href:'http://test/#top100'};
    const runtime={};Object.defineProperty(runtime,'pageRouteTargets',{get(){throw Error('uninitialized');}});
    assert.equal(createNavigationController(runtime).requestedPageRoute(),'top100');
    globalThis.location.hash='#top300';
    assert.equal(createNavigationController(runtime).requestedPageRoute(),'top100');
  } finally {if(prior===undefined)delete globalThis.location;else globalThis.location=prior;}
});


test('Featured applies every priority in order and ranks known losses above missing growth', () => {
  const keys=['boost','paidListing','premier','pro','capGrowthUsd','volumeUsd','holderGrowth','communityCount','socialChannels','trades'];
  const baseline={mint:'Z',boost:0,paidListing:false,tier:'standard',capGrowthUsd:0,volumeUsd:0,holderGrowth:0,communityCount:0,socialChannels:0,trades:0};
  const set=(row,key,value)=>{if(['premier','pro'].includes(key))row.tier=key;else row[key]=value;};
  for(let index=0;index<keys.length-1;index++) {
    const higher={...baseline,mint:'Z'},lower={...baseline,mint:'A'};
    set(higher,keys[index],keys[index]==='paidListing'?true:1);
    set(lower,keys[index+1],keys[index+1]==='paidListing'?true:999);
    assert.equal(rankTop100([lower,higher]).rows[0].mint,'Z',keys[index]);
  }
  const rows=[{mint:'A',capGrowthUsd:null},{mint:'B',capGrowthUsd:-500},{mint:'C',capGrowthUsd:0}];
  assert.deepEqual(rankTop100(rows).rows.map(row=>row.mint),['C','B','A']);
  assert.deepEqual(rankTop100(rows,{sort:'market-cap'}).rows.map(row=>row.mint),['C','B']);
});

test('24h growth never substitutes current cap, partial holder totals or incomplete baselines', () => {
  const community=metrics({[mint]:-12});
  community.growth.items[mint].holders={delta:-3,from:now-86400000,to:now};
  const asset={address:mint,marketCapUsd:1e9,holderWalletCount:1000,capGrowthUsd:999,holderGrowth:999};
  const row=top100Records([asset],{community,now})[0];
  assert.equal(row.capGrowthUsd,-12);assert.equal(row.holderGrowth,-3);
  for(const patch of [{from:now-3600000},{from:now-86400000-600001},{to:now-300001},{to:now+1}]) {
    const bad=structuredClone(community);Object.assign(bad.growth.items[mint].marketCapUsd,patch);
    assert.equal(top100Records([asset],{community:bad,now})[0].capGrowthUsd,null);
  }
  assert.equal(top100Records([asset],{now})[0].holderGrowth,null);
  assert.equal(top100Records([asset],{now,community:{...community,cluster:'mainnet-beta'}})[0].capGrowthUsd,null);
});
