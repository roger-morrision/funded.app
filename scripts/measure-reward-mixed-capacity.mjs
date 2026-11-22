import assert from 'node:assert/strict';
import {readFile,mkdtemp,realpath,rm,open,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {getHeapStatistics} from 'node:v8';
import {mixedCapacityCohort} from '../tests/readiness/reward-capacity-mixed-fixture.mjs';
import {capacityWorkerComponents,capacityProgram,assertCapacityRecords} from '../tests/readiness/reward-capacity-workload.mjs';
import {writeCapacityBundle,readCapacityBundle} from '../tests/readiness/reward-capacity-bundle.mjs';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';

const values=new Map();for(const a of process.argv.slice(2)){
  const match=/^--(count|export|resume|bundle-sha)=(.+)$/.exec(a);
  if(a==='--require-cgroup'){assert(!values.has('require-cgroup'));values.set('require-cgroup',true);continue;}
  assert(match&&!values.has(match[1]),'Unknown or duplicate workload option.');values.set(match[1],match[2]);
}
const count=Number(values.get('count')||33),resume=values.get('resume');assert(Number.isSafeInteger(count)&&count>=1&&count<=1001);
assert(!resume||values.has('bundle-sha')&&!values.has('export')&&!values.has('count'),'Resume requires only an externally retained digest, not fresh construction.');
const cgroup=async()=>{
  const out={};for(const file of ['memory.max','memory.swap.max','memory.current','memory.peak','memory.events','cpu.max','cpu.stat']){
    try{out[file]=(await readFile('/sys/fs/cgroup/'+file,'utf8')).trim();}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;out[file]=null;}
  }return out;
};
const beforeCgroup=await cgroup();if(values.has('require-cgroup')){
  assert.equal(process.platform,'linux');assert.equal(beforeCgroup['memory.max'],'536870912');
  assert.equal(beforeCgroup['memory.swap.max'],'0');assert.equal(beforeCgroup['cpu.max'],'75000 100000');
}
const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-mixed-capacity-'));
try{
  let cohorts,restored;
  if(resume){restored=await readCapacityBundle(resolve(resume),values.get('bundle-sha'));cohorts=restored.cohorts;}
  else{cohorts=[];for(const assetName of ['SOL','USDC']){
    const c=await mixedCapacityCohort({count,assetName});cohorts.push(c);
    process.stderr.write(JSON.stringify({stage:'mixed-constructed',...c.profile,mixed:c.mixedProfile,maxRssKiB:process.resourceUsage().maxRSS})+'\n');
  }}
  const path=join(dir,'ledger.json'),store=createAutomaticRewardStore(path);
  if(restored){const f=await open(path,'wx');try{await f.writeFile(restored.ledgerBytes);await f.sync();}finally{await f.close();}}
  else await store.transaction(s=>{s.schedules=Object.fromEntries(cohorts.map(c=>[c.plan.id,c.plan]));
    s.programs[cohorts[0].plan.mint]=capacityProgram(cohorts[0].plan.mint);});
  const initialBytes=Number((await stat(path)).size),metrics={reads:0,transactions:0,candidateSerializedBytes:0,
    mutatorInsideLockMs:0,transactionElapsedMs:0,instrumentationSerializationMs:0,financialSnapshotReads:0};
  const measured={...store,read:async()=>{metrics.reads++;return store.read();},
    readFinancialSnapshot:async()=>{metrics.financialSnapshotReads++;return store.readFinancialSnapshot();},
    transaction:async mutate=>{const start=performance.now();try{return await store.transaction(async s=>{
      const began=performance.now(),result=await mutate(s);metrics.mutatorInsideLockMs+=performance.now()-began;
      const serialize=performance.now();metrics.candidateSerializedBytes+=Buffer.byteLength(JSON.stringify(s));
      metrics.instrumentationSerializationMs+=performance.now()-serialize;return result;
    });}finally{metrics.transactions++;metrics.transactionElapsedMs+=performance.now()-start;}}};
  process.stderr.write(JSON.stringify({stage:'worker-start',resume:!!resume,initialBytes,cgroup:await cgroup()})+'\n');
  const start=performance.now(),workload=await capacityWorkerComponents({store:measured,cohorts,now:resume?200041:200010}),elapsedMs=performance.now()-start;
  const reopened=createAutomaticRewardStore(path);assertCapacityRecords(await reopened.read(),cohorts);
  let exportedIndexSha=null;if(values.has('export'))exportedIndexSha=await writeCapacityBundle(resolve(values.get('export')),await readFile(path),cohorts);
  process.stdout.write(JSON.stringify({scope:'synthetic-mixed-proof-selected-scheduler-components-not-full-app-or-live-finality',node:process.version,
    platform:process.platform,nodeExecArgv:process.execArgv,processRestartFromBundle:!!resume,exportedIndexSha,
    cohorts:cohorts.map(c=>({preparedInput:c.profile,mixed:c.mixedProfile})),initialLedgerBytes:initialBytes,
    finalLedgerBytes:Number((await stat(path)).size),workload:{...workload,elapsedMs,...metrics},
    resource:{peakRssKiB:process.resourceUsage().maxRSS,...process.memoryUsage(),heapLimitBytes:getHeapStatistics().heap_size_limit,
      constrainedMemoryBytes:process.constrainedMemory(),beforeCgroup,afterCgroup:await cgroup()},networkCalls:0,onChainTransactions:0,
    limits:'Actual scheduler captureDue/prepare/selected execute/status and financial snapshot; normalized capture callback and bank/finality are synthetic. No automatic Devnet batch, HTTP server, other service loop, Mainnet activation or full-app capacity acceptance.',
    instrumentation:'Candidate JSON observer adds measured serialization inside the lock. Transaction elapsed aggregates overlapping queue waits; do not treat it as wall time or add it to worker elapsed. Physical replacement counts are not inferred during concurrent activity. Linux tmpfs/controlled public bundle copying is not production disk/power-loss/financial restore acceptance.'},null,2)+'\n');
}finally{const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});}
