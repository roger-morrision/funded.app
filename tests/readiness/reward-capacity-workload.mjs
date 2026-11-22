import assert from 'node:assert/strict';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';

export function capacityProgram(mint){return {mint,enabled:true,kind:'holder',asset:'SOL',sampleIntervalSeconds:30,
  periodSeconds:3600,payoutDelaySeconds:60,activatedAt:200010,firstPeriodStart:201600,excludedWallets:[]};}

export function assertCapacityRecords(state,cohorts){
  for(const c of cohorts){const row=state.schedules[c.plan.id];assert(row);
    assert.equal(JSON.stringify(row.payoutAttempts),JSON.stringify(c.plan.payoutAttempts),'Original signed attempts/proofs changed.');
    for(const leaf of c.plan.manifest.leaves){
      if(c.plan.payoutAttempts[leaf.recipient].state==='verified')assert.deepEqual(row.payments[leaf.recipient],c.plan.payments[leaf.recipient]);
      else assert.notEqual(row.payments[leaf.recipient]?.status,'paid','Unknown attempt became paid.');
    }
  }
}

// Exercise REAL scheduler component methods. Explicit selected IDs retain the
// single-receipt path; automatic Devnet batch and other service loops are NOT
// modeled as complete production worker/app capacity.
export async function capacityWorkerComponents({store,cohorts,now=200010}){
  const byId=new Map(cohorts.map(c=>[c.plan.id,c])),primary=cohorts[0],sends=cohorts.map(c=>c.f.sends),nonces=cohorts.map(c=>c.f.latestCalls);
  let savedOrFreshCalls=0,captures=0;const chain={...primary.chain,
    ensureCycle:(p,o)=>byId.get(p.id).chain.ensureCycle(p,o),
    submitLeaf:async(p,l,o)=>{savedOrFreshCalls++;return byId.get(p.id).chain.submitLeaf(p,l,o);}};
  const scheduler=createRewardScheduler({store,chain,cluster:'devnet',indexer:{capture:async(mint,at)=>{
    captures++;const row={at:Math.floor(at/1000),slot:primary.f.slot,accounts:primary.plan.manifest.leaves.map(l=>({wallet:l.recipient,balance:'1000'}))};
    await store.transaction(s=>{s.holderSnapshots[mint]||=[];s.holderSnapshots[mint].push(row);});return row;
  }}});
  const capture=await scheduler.captureDue(now),prepared=await scheduler.prepare(now);
  const result=await Promise.all([scheduler.execute(now,cohorts.map(c=>c.plan.id)),scheduler.status(new Date(now*1000)),
    store.readFinancialSnapshot().then(s=>({schedules:Object.keys(s.schedules).length,responseBytes:Buffer.byteLength(JSON.stringify(s))}))]);
  assert.equal(result[0].submitted,0);assert.equal(result[0].status,'processed');assert.equal(prepared.length,0);
  assert.equal(capture.failures.length,0);assert.equal(captures,1);
  for(const [i,c] of cohorts.entries()){assert.equal(c.f.sends,sends[i]);assert.equal(c.f.latestCalls,nonces[i]);}
  assertCapacityRecords(await store.read(),cohorts);
  return {execution:result[0],publicStatus:result[1].status,publicScheduleRows:result[1].schedules.length,
    financialSnapshot:result[2],captures,prepared:prepared.length,submitInterfaces:savedOrFreshCalls,
    networkCalls:0,onChainTransactions:0,newBlockhashes:0,newMockSends:0};
}
