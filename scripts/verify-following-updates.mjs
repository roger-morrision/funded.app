import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStore} from '../server/store.mjs';
import {followingWindow,followingUpdatesPage} from '../server/following-updates.mjs';
import {creatorDirectoryRecords} from '../server/creator-directory.mjs';
import {createFollowingFeed} from '../following-feed.js';

export async function verifyFollowingStore(store,other=store) {
  const ids=Array.from({length:200},(_,i)=>String(100000+i));
  await store.update(s=>{s.creatorProfiles||={};for(const id of ids)s.creatorProfiles[id]={id,handle:`@fixture${id}`,name:'Synthetic only',identityVerified:true,listed:true,updates:Array.from({length:3},(_,i)=>({id:String(i+1).padStart(24,'0'),text:`Update ${i+1}`,createdAt:'2026-09-21T00:00:00Z',secret:'must not leak'})),following:['private-follow']};s.creatorProfiles[ids[0]].optedOut=true;s.creatorProfiles[ids[1]].listed=false;s.creatorProfiles[ids[1]].identityVerified=false;});
  let cursor='',seen=[];const state=await store.read();
  do {
    const page=await other.readFollowingUpdates('devnet',ids,cursor);
    assert.deepEqual(page,followingUpdatesPage(creatorDirectoryRecords(state,'devnet'),state.creatorProfiles,ids,cursor));
    assert.equal(page.checkedCount,20);assert.ok(page.creators.length<=20);assert.doesNotMatch(JSON.stringify(page),/private-follow|must not leak/);
    for(const creator of page.creators)assert.deepEqual(creator.updates.map(row=>row.text),['Update 3','Update 2']);
    seen.push(...page.creators.map(row=>row.id));cursor=page.nextCursor;
  }while(cursor);
  assert.equal(new Set(seen).size,198);assert.deepEqual(seen,ids.slice(2));
  const durations=[];
  for(let batch=0;batch<10;batch++)await Promise.all(Array.from({length:10},async()=>{const began=performance.now();const page=await other.readFollowingUpdates('devnet',ids);durations.push(performance.now()-began);assert.ok(page.creators.length<=20);}));
  durations.sort((a,b)=>a-b);console.log(`Synthetic following read baseline: 200 follows, 100 reads, concurrency 10, p95 ${durations[94].toFixed(1)}ms. Not a production load/capacity claim.`);
  assert.equal((await other.readFollowingUpdates('devnet',[])).creators.length,0,'Empty follows must never fall back to global discovery.');
  assert.equal((await other.readFollowingUpdates('devnet',[ids[2],ids[2]])).checkedCount,1);
  await assert.rejects(other.readFollowingUpdates('devnet',[...ids,'999']));
  await assert.rejects(other.readFollowingUpdates('devnet',['bad']));
  await assert.rejects(other.readFollowingUpdates('devnet',ids,'999'));
  await store.updateCreatorProfile(ids[2],s=>{s.creatorProfiles[ids[2]].optedOut=true;});
  assert.equal((await other.readFollowingUpdates('devnet',[ids[2]])).creators.length,0,'Opt-out is visible immediately without a cache TTL.');
  await store.update(s=>{for(const id of ids)delete s.creatorProfiles[id];});
}

async function verifyFeed() {
  let view,calls=0,resolveOld;
  const pages=(ids,after)=>({creators:[{id:after||ids[0],updates:[]}],nextCursor:after?null:'120',checkedCount:20,requestedCount:21,limit:20});
  let load=async(ids,after)=>pages(ids,after);
  const feed=createFollowingFeed({load:(...args)=>{calls++;return load(...args);},render:next=>view=next});
  const ids=Array.from({length:21},(_,i)=>String(100+i));
  feed.setContext(ids,false);await feed.refresh();assert.equal(calls,0);
  feed.setContext(ids,true);await feed.refresh();assert.equal(view.nextCursor,'120');
  await feed.next();assert.equal(view.after,'120');assert.deepEqual(view.previous,['']);
  await feed.previous();assert.equal(view.after,'');
  load=async()=>{throw new Error('unavailable');};await feed.next();assert.match(view.error,/Retry/);assert.equal(view.after,'120');assert.equal(view.creators.length,0);
  load=async(ids,after)=>pages(ids,after);await feed.refresh();assert.equal(view.after,'120');assert.equal(view.error,'');
  load=()=>new Promise(resolve=>resolveOld=resolve);const old=feed.refresh();feed.setContext(ids,false);assert.equal(view.creators.length,0);resolveOld(pages(ids,''));await old;assert.equal(view.creators.length,0,'Disabled consent discards late responses.');
  feed.setContext(ids,true);const beforeChange=feed.refresh();feed.setContext(['999'],true);resolveOld(pages(ids,''));await beforeChange;assert.equal(view.creators.length,0,'Changed follows discard old responses.');assert.equal(view.after,'');
  load=async(ids,after)=>pages(ids,after);await feed.refresh();assert.equal(view.creators[0].id,'999');feed.dispose();assert.equal(view.creators.length,0);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const dir=await mkdtemp(join(tmpdir(),'funded-following-'));try{await verifyFollowingStore(createStore(join(dir,'state.json'),''));await verifyFeed();assert.throws(()=>followingWindow([1]));console.log('Following updates: all 200 follows, bounded pages, privacy, safe fields, empty filters, retries and stale consent/follow responses passed.');}finally{await rm(dir,{recursive:true,force:true});}}
