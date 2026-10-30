import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';

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
  }finally{await rm(directory,{recursive:true,force:true});}
});
