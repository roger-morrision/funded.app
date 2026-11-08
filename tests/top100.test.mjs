import test from 'node:test';
import assert from 'node:assert/strict';
import {top100Records,rankTop100} from '../src/features/explore/top100-model.js';
import {createNavigationController} from '../src/app/controllers/navigation.js';
import {loadTop100Feed,readAccountBatches} from '../src/features/explore/top100-feed.js';

const mint = 'A'.repeat(32), other = 'B'.repeat(32), now = Date.now();
test('Top 100 keeps organic ranking separate from active sponsored boosts', () => {
  const records = top100Records([{address:mint,curveCapSol:5},{address:other,curveCapSol:10}],
    {solUsd:100,now,boosts:{[mint]:{multiplier:50,expiresAt:new Date(now+60000).toISOString()}}});
  assert.equal(rankTop100(records).rows[0].mint,other);
  assert.equal(rankTop100(records,{sort:'boosted'}).rows[0].mint,mint);
  assert.equal(rankTop100(top100Records(records,{now:now+60001,boosts:{[mint]:{multiplier:50,expiresAt:new Date(now+60000).toISOString()}}}),{sort:'boosted'}).rows.length,0);
});
test('missing metrics, stale activity, migrated curve reserves and listing age are not invented', () => {
  const rows = top100Records([{address:mint,complete:true,curveCapSol:500,listingPayment:{verified:true},createdTimestamp:now/1000-3600,
    volume24hSol:20,tradeCount24h:9,marketActivityObservedAt:now-300001},{address:other,curveCapSol:0}],{solUsd:100,now});
  assert.equal(rows[0].capUsd,null);assert.equal(rows[0].volumeUsd,null);assert.equal(rows[0].trades,null);assert.equal(rows[0].ageHours,null);
  assert.equal(rankTop100(rows).rows[0].capUsd,0);
  assert.equal(rankTop100(rows,{sort:'volume'}).rows.length,0);
});
test('rank ceiling, deterministic ties and filters preserve global rank', () => {
  const rows=Array.from({length:350},(_,i)=>({mint:String(i).padStart(4,'0'),name:`Coin ${i}`,symbol:`C${i}`,capUsd:350-i,volumeUsd:350-i,trades:350-i,boost:350-i,stage:'curve',tier:'pro',ageHours:2}));
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
