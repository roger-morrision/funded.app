import test from 'node:test';import assert from 'node:assert/strict';
import {createHolderSnapshotWorker} from '../../server/holder-snapshot-worker.mjs';
import {snapshotsForPeriod} from '../../server/holder-history-indexer.mjs';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';

function fixture(){const state={programs:{mint:{mint:'mint',enabled:true,sampleIntervalSeconds:60}},holderSnapshots:{mint:[]}};
 return{state,store:{read:async()=>structuredClone(state),transaction:async fn=>fn(state)}};}
test('independent holder observer preserves coverage while app and signing are absent',async()=>{
 const {state,store}=fixture();let time=0;
 const indexer={capture:async(mint,ms)=>{const row={mint,at:ms/1000,slot:ms/1000+1,finalized:true,accounts:[]};state.holderSnapshots.mint.push(row);return row;}};
 const worker=createHolderSnapshotWorker({store,indexer,now:()=>time});
 // No app, signer or payout worker runs during this complete reward period.
 for(time=0;time<=360000;time+=30000)await worker.tick();
 assert.equal(state.holderSnapshots.mint.length,7);assert.equal(state.holderIndexerStatus.status,'active');
 assert.equal(snapshotsForPeriod(state.holderSnapshots.mint,60,360,120).length,6);
});
test('observer failure creates no synthetic snapshot and prevents overlapping captures',async()=>{
 const {state,store}=fixture();let finish,calls=0;
 const worker=createHolderSnapshotWorker({store,indexer:{capture:async()=>{calls++;await new Promise(r=>finish=r);throw Error('RPC unavailable');}},now:()=>60000});
 const first=worker.tick(),second=worker.tick();assert.equal(first,second);await new Promise(r=>setImmediate(r));finish();await first;
 assert.equal(calls,1);assert.equal(state.holderSnapshots.mint.length,0);assert.equal(state.holderIndexerStatus.status,'degraded');
 assert.throws(()=>snapshotsForPeriod(state.holderSnapshots.mint,0,60,120),/do not cover/);
});
test('external sampling mode does not recapture or require a signer to observe holders',async()=>{
 const state={};let captures=0;
 const store={read:async()=>structuredClone(state),transaction:async f=>f(state)};
 const scheduler=createRewardScheduler({store,indexer:{capture:async()=>{captures++;}},captureSnapshots:false,
  chain:{cluster:'devnet',readiness:async()=>({constrainedPayouts:false,reasons:['upgrade in progress']})}});
 const result=await scheduler.tick(600);assert.equal(result.status,'unavailable');assert.equal(captures,0);
});
