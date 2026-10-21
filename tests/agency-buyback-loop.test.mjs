import test from 'node:test';
import assert from 'node:assert/strict';
import {agencyBuybackWaitMs,runAgencyBuybackLoop} from '../server/agency-buyback-loop.mjs';
import {agencyBuybackWorkerHealth} from '../server/agency-deployment.mjs';

test('observed slow successful cycles stay within the unchanged readiness age without overlapping',async()=>{
  let clock=0,cycles=0,active=0;
  const completed=[],waits=[],durations=[52000,67000,58000];
  const health={programId:'program',approvedHash:'hash',authority:'authority',revision:'4',build:'b'.repeat(40)};
  const state={adminSettings:{agencyBuybackWorker:{status:'ready',version:'agency-buyback-executor-v1',cluster:'devnet',
    programId:health.programId,approvedHash:health.approvedHash,authority:health.authority,configRevision:'4',build:health.build,
    capabilities:['buyback-100k','buyback-300k']}}};
  await runAgencyBuybackLoop({config:{mode:'loop',intervalMs:60000},now:()=>clock,shouldStop:()=>cycles===durations.length,
    runCycle:async()=>{assert.equal(active++,0);clock+=durations[cycles++];completed.push(clock);
      state.adminSettings.agencyBuybackWorker.checkedAt=new Date(clock).toISOString();active--;},
    onBlocked:async()=>assert.fail('Verified successful cycles must not be blocked'),
    wait:async ms=>{assert.equal(active,0);waits.push(ms);clock+=ms;},
  });
  assert.deepEqual(waits,[8000,5000]);assert.deepEqual(completed,[52000,127000,190000]);
  assert(completed.slice(1).every((at,i)=>at-completed[i]<90000));
  const checkedAt=Date.parse(state.adminSettings.agencyBuybackWorker.checkedAt);
  assert(agencyBuybackWorkerHealth(state,{...health,now:checkedAt+89999}));
  assert(!agencyBuybackWorkerHealth(state,{...health,now:checkedAt+90000}),'A stalled worker must still expire at 90 seconds');
});

test('verification failures retain full polling backoff and are never marked successful',async()=>{
  let clock=0,cycles=0,blocked=0;const waits=[];
  await runAgencyBuybackLoop({config:{mode:'loop',intervalMs:60000},now:()=>clock,shouldStop:()=>cycles===2,
    runCycle:async()=>{cycles++;clock+=67000;throw new Error('RPC unavailable');},onBlocked:async error=>{assert.match(error.message,/RPC/);blocked++;},
    wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.equal(blocked,2);assert.deepEqual(waits,[60000]);
});

test('stop before work, during work, or during idle cannot schedule an extra cycle',async()=>{
  for(const phase of ['before','work','idle']){
    let stopped=phase==='before',cycles=0,waits=0;
    await runAgencyBuybackLoop({config:{mode:'loop',intervalMs:60000},now:()=>0,shouldStop:()=>stopped,
      runCycle:async()=>{cycles++;if(phase==='work')stopped=true;},onBlocked:async()=>assert.fail(),
      wait:async()=>{waits++;stopped=true;}});
    assert.equal(cycles,phase==='before'?0:1);assert.equal(waits,phase==='idle'?1:0);
  }
});

test('once mode never polls again and successful busy cycles retain a minimum idle',async()=>{
  let cycles=0;
  await runAgencyBuybackLoop({config:{mode:'once',intervalMs:60000},now:()=>0,runCycle:async()=>cycles++,onBlocked:async()=>assert.fail(),wait:async()=>assert.fail()});
  assert.equal(cycles,1);assert.equal(agencyBuybackWaitMs(60000,0),60000);assert.equal(agencyBuybackWaitMs(60000,180000),5000);
  for(const [interval,duration]of [[60000,-1],[60000,NaN],[Infinity,0],[0,0]])assert.throws(()=>agencyBuybackWaitMs(interval,duration));
});
