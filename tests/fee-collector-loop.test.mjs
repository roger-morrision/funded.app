import test from 'node:test';
import assert from 'node:assert/strict';
import {runFeeCollectorLoop} from '../scripts/fee-collector-loop.mjs';
const ready=counts=>({status:'ready',collected:0,settled:0,disbursed:0,settlementErrors:0,...counts});
test('one trade wake advances collection, settlement and payouts, then resumes idle polling',async()=>{
 const events=[],lifecycle={stopped:false,wait:async ms=>{assert.equal(ms,5000);events.push('wait');if(events.at(-2)==='idle')lifecycle.stopped=true;}};
 const stages=[['collect',ready({collected:1})],['settle',ready({settled:1})],['pay',ready({disbursed:7})],['idle',ready({})]];
 let wakes=0;
 await runFeeCollectorLoop({lifecycle,shouldRun:async()=>{wakes++;return wakes===1;},tick:async()=>{
  const [stage,result]=stages.shift();events.push(stage);return result;},onError:error=>{throw error;}});
 assert.deepEqual(events,['collect','wait','settle','wait','pay','wait','idle','wait']);assert.equal(wakes,1);assert.equal(stages.length,0);
});
test('a failed or degraded phase cannot bypass the next normal wake check',async()=>{
 for(const failure of [Error('uncertain submission'),ready({settled:1,settlementErrors:1,status:'degraded'})]){
  let wakes=0,ticks=0,errors=0;
  const lifecycle={stopped:false,wait:async()=>{if(wakes===2)lifecycle.stopped=true;}};
  await runFeeCollectorLoop({lifecycle,shouldRun:async()=>++wakes===1,tick:async()=>{ticks++;if(failure instanceof Error)throw failure;return failure;},onError:async()=>{errors++;}});
  assert.equal(ticks,1);assert.equal(wakes,2);assert.equal(errors,failure instanceof Error?1:0);
 }
});
test('an operator once invocation remains a single bounded tick',async()=>{
 let ticks=0;await runFeeCollectorLoop({lifecycle:{stopped:false,wait:()=>assert.fail()},once:true,
  shouldRun:()=>assert.fail(),tick:async()=>{ticks++;return ready({collected:1});},onError:error=>{throw error;}});assert.equal(ticks,1);
});
