import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {getHeapStatistics} from 'node:v8';
import {Keypair} from '@solana/web3.js';
import {buildRewardManifest} from '../reward-merkle.js';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';
import {createRewardScheduler} from '../server/reward-scheduler.mjs';
import {mixedCapacityCohort} from '../tests/readiness/reward-capacity-mixed-fixture.mjs';
import {capacityProgram,assertCapacityRecords} from '../tests/readiness/reward-capacity-workload.mjs';

const args=process.argv.slice(2);assert(args.length===1||args.length===2,'Use --count=33..1001 [--require-cgroup].');
const count=Number(args.find(a=>a.startsWith('--count='))?.slice(8));
assert(Number.isSafeInteger(count)&&count>=33&&count<=1001&&args.every(a=>a==='--require-cgroup'||/^--count=\d+$/.test(a)));
const cgroup=async()=>{
  const out={};for(const name of ['memory.max','memory.swap.max','memory.peak','memory.events','cpu.max','cpu.stat']){
    try{out[name]=(await readFile('/sys/fs/cgroup/'+name,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;out[name]=null;}
  }return out;
};
const beforeCgroup=await cgroup();if(args.includes('--require-cgroup')){
  assert.equal(process.platform,'linux');assert.equal(beforeCgroup['memory.max'],'536870912');
  assert.equal(beforeCgroup['memory.swap.max'],'0');assert.equal(beforeCgroup['cpu.max'],'75000 100000');
}
const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-normal-worker-'));
try{
  const cohorts=[];for(const assetName of ['SOL','USDC'])cohorts.push(await mixedCapacityCohort({count,assetName}));
  const original=cohorts[0].plan,cycleId=createHash('sha256').update('normal-worker-fresh:'+count).digest('hex');
  const allocations=Array.from({length:count},(_,i)=>({recipient:String(Keypair.fromSeed(createHash('sha256')
    .update('normal-worker-fresh-recipient:'+i).digest()).publicKey),amount:String(100+i%17)}));
  const manifest=buildRewardManifest({cycleId,asset:'SOL',allocations});
  const fresh={...structuredClone(original),id:'normal-worker-fresh',cycle:String(Keypair.fromSeed(createHash('sha256')
    .update('normal-worker-fresh-cycle').digest()).publicKey),asset:'SOL',manifest,payments:{},payoutAttempts:{}};
  const path=join(dir,'ledger.json'),store=createAutomaticRewardStore(path),byId=new Map(cohorts.map(c=>[c.plan.id,c]));
  await store.transaction(s=>{s.schedules={...Object.fromEntries(cohorts.map(c=>[c.plan.id,c.plan])),[fresh.id]:fresh};
    s.programs[original.mint]=capacityProgram(original.mint);});
  const initialBytes=Number((await stat(path)).size),metrics={transactions:0,reads:0,financialSnapshotReads:0,
    candidateSerializedBytes:0,instrumentationSerializationMs:0,mutatorInsideLockMs:0,transactionElapsedMs:0};
  const measured={...store,read:async()=>{metrics.reads++;return store.read();},
    readFinancialSnapshot:async()=>{metrics.financialSnapshotReads++;return store.readFinancialSnapshot();},
    transaction:async mutate=>{const start=performance.now();try{return await store.transaction(async state=>{
      const began=performance.now(),result=await mutate(state);metrics.mutatorInsideLockMs+=performance.now()-began;
      const serialize=performance.now();metrics.candidateSerializedBytes+=Buffer.byteLength(JSON.stringify(state));
      metrics.instrumentationSerializationMs+=performance.now()-serialize;return result;
    });}finally{metrics.transactions++;metrics.transactionElapsedMs+=performance.now()-start;}}};
  const primary=cohorts[0],originalSends=cohorts.map(c=>c.f.sends),originalNonces=cohorts.map(c=>c.f.latestCalls);
  let freshCalls=0,mixedCalls=0,captures=0;
  const chain={...primary.chain,
    ensureCycle:(plan,options)=>plan.id===fresh.id?{address:fresh.cycle,receiptMode:'legacy'}:byId.get(plan.id).chain.ensureCycle(plan,options),
    submitLeaf:async(plan,leaf,options)=>{
      if(plan.id===fresh.id){freshCalls++;return{signature:'synthetic-result-'+leaf.index,finalized:true,
        balanceDeltaVerified:true,amountReceived:leaf.amount};}
      mixedCalls++;return byId.get(plan.id).chain.submitLeaf(plan,leaf,options);
    }};
  const scheduler=createRewardScheduler({store:measured,chain,cluster:'devnet',indexer:{capture:async(mint,at)=>{
    captures++;const row={at:Math.floor(at/1000),slot:primary.f.slot,
      accounts:original.manifest.leaves.map(leaf=>({wallet:leaf.recipient,balance:'1000'}))};
    await measured.transaction(s=>{s.holderSnapshots[mint]||=[];s.holderSnapshots[mint].push(row);});return row;
  }}});
  const started=performance.now(),capture=await scheduler.captureDue(200010),prepared=await scheduler.prepare(200010);
  assert.equal(capture.failures.length,0);assert.equal(prepared.length,0);
  let rounds=0,submitted=0;const selected=[...cohorts.map(c=>c.plan.id),fresh.id];
  while(submitted<count){const result=await scheduler.execute(200010,selected);submitted+=result.submitted;rounds++;
    assert(rounds<=Math.ceil(count/32)&&result.submitted>0&&result.submitted<=32,'Normal worker did not make bounded progress.');
    if(rounds%4===0||submitted===count)process.stderr.write(JSON.stringify({progress:true,rounds,submitted,
      elapsedMs:performance.now()-started,candidateSerializedBytes:metrics.candidateSerializedBytes,
      peakRssKiB:process.resourceUsage().maxRSS})+'\n');}
  const status=await scheduler.status(new Date(200010000));
  const snapshot=await measured.readFinancialSnapshot();
  const reopened=createAutomaticRewardStore(path),saved=await reopened.read();assertCapacityRecords(saved,cohorts);
  assert.equal(Object.values(saved.schedules[fresh.id].payments).filter(row=>row.status==='paid').length,count);
  for(const [i,c] of cohorts.entries()){assert.equal(c.f.sends,originalSends[i]);assert.equal(c.f.latestCalls,originalNonces[i]);}
  assert.equal(freshCalls,count);assert(mixedCalls>0);
  const scheduleDigest=createHash('sha256').update(JSON.stringify(saved.schedules)).digest('hex');
  const restarted=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./verify-reward-normal-worker-restart.mjs',import.meta.url)),
    path,String(count),scheduleDigest],{maxBuffer:1024*1024});
  const restart=JSON.parse(restarted.stdout);
  process.stdout.write(JSON.stringify({scope:'synthetic-normal-selected-worker-with-mixed-signed-attempts-and-mocked-fresh-outcomes',
    node:process.version,platform:process.platform,count,rounds,submitted,freshCalls,mixedCalls,captures,
    initialLedgerBytes:initialBytes,finalLedgerBytes:Number((await stat(path)).size),
    schedules:status.schedules.length,financialSnapshotBytes:Buffer.byteLength(JSON.stringify(snapshot)),
    elapsedMs:performance.now()-started,metrics,restart,resource:{peakRssKiB:process.resourceUsage().maxRSS,
      heapLimitBytes:getHeapStatistics().heap_size_limit,constrainedMemoryBytes:process.constrainedMemory(),
      beforeCgroup,afterCgroup:await cgroup()},networkCalls:0,onChainTransactions:0,
    limits:'Mocked finalized result interfaces and synthetic bank/finality. This exercises real scheduler/store/selected paging, not authoritative receipts, full HTTP/background service, production disk restore, live financial throughput or cap admission.'},null,2)+'\n');
}finally{const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});}
