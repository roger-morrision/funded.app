import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {getHeapStatistics} from 'node:v8';
import {signedCapacityCohort} from '../tests/readiness/reward-capacity-fixture.mjs';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';
import {selectHolderPayoutPage} from '../server/holder-payout-page.mjs';
import {recoverSavedRewardPayouts} from '../server/reward-payout-recovery.mjs';

const args=process.argv.slice(2);assert(args.every(a=>/^--(count|assets|read-mode)=/.test(a))&&new Set(args.map(a=>a.split('=')[0])).size===args.length,'Only count/assets/read-mode inputs accepted.');
const count=Number(args.find(a=>a.startsWith('--count='))?.slice(8)||33);
const assets=(args.find(a=>a.startsWith('--assets='))?.slice(9)||'SOL,USDC').split(',');
const readMode=args.find(a=>a.startsWith('--read-mode='))?.slice(12)||'legacy';
assert(Number.isSafeInteger(count)&&count>=1&&count<=1001&&assets.length>=1&&assets.length<=3
  &&new Set(assets).size===assets.length&&assets.every(a=>['SOL','USDC','Token2022'].includes(a))
  &&['legacy','targeted'].includes(readMode),'Invalid declared offline capacity scope.');
const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-signed-capacity-'));
try{
  const cohorts=[];for(const assetName of assets){
    const c=await signedCapacityCohort({count,assetName});cohorts.push(c);
    process.stderr.write(JSON.stringify({stage:'constructed',...c.profile,maxRssKiB:process.resourceUsage().maxRSS})+'\n');
  }
  const path=join(dir,'ledger.json'),store=createAutomaticRewardStore(path);
  await store.transaction(s=>{s.schedules=Object.fromEntries(cohorts.map(c=>[c.plan.id,c.plan]));});
  const ledgerBytes=Number((await stat(path)).size),original=cohorts.map(c=>JSON.stringify(c.plan.payoutAttempts));
  let counters;
  const reset=()=>{counters={reads:0,targetedReads:0,transactions:0,serializedCandidateBytes:0,ledgerReplacements:0,ledgerWriteBytes:0,
    mutatorInsideLockMs:0,transactionElapsedMs:0,instrumentationSerializeMs:0};};reset();
  const measured={read:async()=>{counters.reads++;return store.read();},transaction:async mutate=>{
    const before=await stat(path,{bigint:true}),start=performance.now();assert(before.ino>0n);
    try{return await store.transaction(async s=>{const began=performance.now(),result=await mutate(s);counters.mutatorInsideLockMs+=performance.now()-began;
      const serialization=performance.now();counters.serializedCandidateBytes+=Buffer.byteLength(JSON.stringify(s));
      counters.instrumentationSerializeMs+=performance.now()-serialization;return result;});}
    finally{const after=await stat(path,{bigint:true});if(after.ino!==before.ino){counters.ledgerReplacements++;counters.ledgerWriteBytes+=Number(after.size);}
      counters.transactions++;counters.transactionElapsedMs+=performance.now()-start;}}};
  if(readMode==='targeted')measured.readSchedule=async id=>{counters.targetedReads++;return store.readSchedule(id);};
  let start=performance.now();assert.equal((await selectHolderPayoutPage({store:measured,plan:cohorts[0].plan})).length,Math.min(count,32));
  const fresh={...counters,elapsedMs:performance.now()-start,maxRssKiB:process.resourceUsage().maxRSS};reset();
  const rpcMethods={};for(const c of cohorts)for(const method of ['getGenesisHash','getSignatureStatuses','getTransaction']){
    const original=c.f.connection[method];c.f.connection[method]=async(...a)=>{rpcMethods[method]=(rpcMethods[method]||0)+1;return original(...a);};
  }
  let recoveryCalls=0;const byId=new Map(cohorts.map(c=>[c.plan.id,c]));start=performance.now();
  const recovered=await recoverSavedRewardPayouts({store:measured,chain:{submitLeaf:async(p,l,o)=>{
    assert.equal(o.recoveryOnly,true);recoveryCalls++;return byId.get(p.id).chain.submitLeaf(p,l,o);
  }}});assert.equal(recovered,0);assert.equal(recoveryCalls,Math.min(count*assets.length,32));
  const recovery={...counters,elapsedMs:performance.now()-start,interfaceCalls:recoveryCalls,rpcMethods,maxRssKiB:process.resourceUsage().maxRSS};
  const reopened=await createAutomaticRewardStore(path).read();
  for(const [i,c] of cohorts.entries()){
    assert.equal(JSON.stringify(reopened.schedules[c.plan.id].payoutAttempts),original[i]);
    assert.deepEqual(reopened.schedules[c.plan.id].payments,{});assert.equal(c.f.sends,count);assert.equal(c.f.latestCalls,count);
  }
  process.stdout.write(JSON.stringify({scope:'offline-canonical-prepared-wires-not-finalized-proof-or-production-capacity',node:process.version,
    countPerCohort:count,assets,readMode,nodeExecArgv:process.execArgv,cohorts:cohorts.map(c=>c.profile),ledgerBytes,fresh,recovery,
    memory:{maxRssKiB:process.resourceUsage().maxRSS,...process.memoryUsage(),v8HeapLimitBytes:getHeapStatistics().heap_size_limit},
    networkCalls:0,onChainTransactions:0,additionalSigningOrMockBroadcastsDuringRecovery:0,
    limits:'A Node old-space flag is not a 512MiB container/RSS/CPU limit. No full-app, finalized-proof, whole-worker, Linux durability, live throughput or admission claim.',
    instrumentation:'Transaction elapsed includes candidate JSON byte-count overhead plus stat observers; mutator time is a subset inside the lock, not full lock hold. RSS includes fixture construction and all retained source bank/manifest objects.'},null,2)+'\n');
}finally{
  const target=await realpath(dir);assert.equal(target,resolve(dir));assert(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});
}
