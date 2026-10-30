import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';
import {createV3LaunchConfig} from '../server/v3-launch-config.mjs';

test('public reward projections omit large indexing buckets and observe independent atomic replacements',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-reward-projection-'));
  try{
    const path=join(directory,'ledger.json'),store=createAutomaticRewardStore(path);
    const state={version:2,programs:{mint:{id:'program'}},schedules:{cycle:{status:'funded'}},dailyBonusSnapshots:{window:{status:'ready'}},
      serviceStatus:{status:'active'},holderSnapshots:{unused:{large:'excluded'}},dailyBonusSettlementIndexes:{unused:{large:'excluded'}}};
    await writeFile(path,JSON.stringify(state));
    const financial=await store.readFinancialSnapshot();
    assert.deepEqual(Object.keys(financial).sort(),['dailyBonusSnapshots','programs','schedules','version']);
    assert.deepEqual(financial.schedules,state.schedules);assert.deepEqual(financial.dailyBonusSnapshots,state.dailyBonusSnapshots);
    assert.deepEqual(await store.readStatusSnapshot(),{serviceStatus:state.serviceStatus,schedules:state.schedules});
    financial.schedules.cycle.status='caller-mutation';
    assert.equal((await store.read()).schedules.cycle.status,'funded');
    state.schedules.cycle.status='paid';state.serviceStatus={status:'unavailable'};
    await writeFile(path+'.next',JSON.stringify(state));await rename(path+'.next',path);
    assert.equal((await store.readFinancialSnapshot()).schedules.cycle.status,'paid');
    assert.deepEqual((await store.readStatusSnapshot()).serviceStatus,{status:'unavailable'});
    assert.deepEqual((await store.read()).holderSnapshots,state.holderSnapshots);
    state.schedules.cycle.status='fail';await writeFile(path,JSON.stringify(state));
    assert.equal((await store.readStatusSnapshot()).schedules.cycle.status,'fail');
    const [first,second]=await Promise.all([store.readFinancialSnapshot(),store.readFinancialSnapshot()]);
    first.schedules.cycle.status='isolated';assert.equal(second.schedules.cycle.status,'fail');
    await store.transaction(value=>{assert.equal(value.schedules.cycle.status,'fail');value.schedules.cycle.status='done';});
    assert.equal((await store.readStatusSnapshot()).schedules.cycle.status,'done');
    await writeFile(path,JSON.stringify({...state,version:999}));await assert.rejects(store.readFinancialSnapshot(),/Unsupported ledger version/);
    await unlink(path);assert.equal((await store.readStatusSnapshot()).serviceStatus,undefined);
    await writeFile(path,JSON.stringify(state));assert.equal((await store.readFinancialSnapshot()).schedules.cycle.status,'fail');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('public automation, bonus and worker views retain required state while excluding settlement indexes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-reward-health-'));
  try{
    const path=join(directory,'ledger.json'),store=createAutomaticRewardStore(path),state={version:2,schedules:{},serviceStatus:{constrainedPayouts:false},
      communityClaimIndex:{status:'verified'},communityDrops:{mint:{snapshotBasis:'devnet-qa-cutoff'}},buybackWorkerHeartbeat:{status:'failed'},
      dailyBonusSnapshots:{day:{status:'paid'}},dailyBonusProgress:{day:{checked:2}},dailyBonusServiceStatus:{status:'degraded'},dailyBonusSettlementIndexes:{privateToIndexer:true}};
    await writeFile(path,JSON.stringify(state));
    assert.deepEqual(await store.readAutomationSnapshot(),{serviceStatus:state.serviceStatus,schedules:{},communityClaimIndex:state.communityClaimIndex,communityDrops:state.communityDrops,buybackWorkerHeartbeat:state.buybackWorkerHeartbeat});
    assert.deepEqual(await store.readWorkerHealth(),{serviceStatus:state.serviceStatus,dailyBonusServiceStatus:state.dailyBonusServiceStatus,buybackWorkerHeartbeat:state.buybackWorkerHeartbeat});
    assert.deepEqual(await store.readBonusSnapshot(),{dailyBonusSnapshots:state.dailyBonusSnapshots,dailyBonusProgress:state.dailyBonusProgress,dailyBonusServiceStatus:state.dailyBonusServiceStatus});
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('launch worker gating uses the current worker projection and closes after an external readiness change',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'funded-worker-gate-'));
  try{
    const path=join(directory,'ledger.json'),store=createAutomaticRewardStore(path);
    const state={version:2,serviceStatus:{constrainedPayouts:true,reasons:[],checkedAt:new Date().toISOString()}};
    await writeFile(path,JSON.stringify(state));
    const config=createV3LaunchConfig({solanaCluster:'devnet',env:{FUNDED_V3_HOLDER_WORKER_ENABLED:'true'},automaticRewardStore:{...store,read:async()=>{throw Error('Full ledger must not be cloned');}}});
    const reason='V3 holder payout worker has no fresh verified readiness';assert.ok(!(await config()).reasons.includes(reason));
    state.serviceStatus.constrainedPayouts=false;state.serviceStatus.reasons=['rpc-quota-exhausted'];
    await writeFile(path+'.next',JSON.stringify(state));await rename(path+'.next',path);
    assert.ok((await config()).reasons.includes(reason));
  }finally{await rm(directory,{recursive:true,force:true});}
});
