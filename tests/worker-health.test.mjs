import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWorkerCycle,workerHealthcheck,monitoredWorkers} from '../scripts/worker-health.mjs';
const build='a'.repeat(40),now=1_000_000;
test('worker health requires fresh completed work from the exact live process and build',()=>{
  for(const role of monitoredWorkers){
    const row={role,status:'completed',readiness:'degraded',pid:20,build,cluster:'devnet',completedAt:now-60_000};
    const options={role,build,now,isAlive:pid=>pid===20};
    assert(assessWorkerCycle(row,options),'Funding gates do not make completed work unhealthy');
    for(const patch of [{status:'failed'},{pid:21},{build:'b'.repeat(40)},{cluster:'mainnet-beta'},
      {completedAt:now+1},{completedAt:now-180_001},{completedAt:null},{role:'unknown'}])
      assert.equal(assessWorkerCycle({...row,...patch},options),false,JSON.stringify(patch));
    assert.equal(assessWorkerCycle(null,options),false);
    assert.deepEqual(workerHealthcheck(role).test,['CMD','node','scripts/worker-health.mjs',role]);
  }
  assert.throws(()=>workerHealthcheck('app'));
});
