import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,appendFile,stat} from 'node:fs/promises';
import {join,resolve,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {buildRewardManifest} from '../../reward-merkle.js';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {recoverSavedRewardPayouts} from '../../server/reward-payout-recovery.mjs';
import {selectRewardPayoutRecoveries} from '../../server/reward-recovery-page.mjs';
import {selectHolderPayoutPage} from '../../server/holder-payout-page.mjs';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';
const keys=Array.from({length:1002},(_,i)=>String(Keypair.fromSeed(createHash('sha256').update('recovery-page-unit:'+i).digest()).publicKey));
async function fixture(t,counts=[33,32]){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-recovery-page-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert.ok(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const path=join(dir,'ledger.json'),store=createAutomaticRewardStore(path),plans=counts.map((count,i)=>{
    const id='schedule-'+i,manifest=buildRewardManifest({cycleId:createHash('sha256').update(id).digest('hex'),asset:'SOL',allocations:keys.slice(0,count).map(recipient=>({recipient,amount:'1'}))});
    return{id,cluster:'devnet',mint:keys[1001],kind:'holder',asset:'SOL',manifest,cutoffAt:100,payoutAt:200,status:'distributing',cycle:keys[1000],payments:{},
      payoutAttempts:Object.fromEntries(manifest.leaves.map(l=>[l.recipient,{state:'prepared',signature:'original-'+id+'-'+l.index}]))};
  });
  await store.transaction(s=>{s.schedules=Object.fromEntries(plans.map(p=>[p.id,p]));});
  return{store,plans,path,reopen:()=>createAutomaticRewardStore(path)};
}
const taskKey=(plan,leaf)=>JSON.stringify([plan.id,leaf.index,leaf.recipient]);

test('saved recovery is bounded fairly across schedules and restart without replacing unknown attempts',async t=>{
  const f=await fixture(t),seen=[],original=(await f.store.read()).schedules;
  const chain={submitLeaf:async(plan,leaf,options)=>{assert.equal(options.recoveryOnly,true);seen.push(taskKey(plan,leaf));throw Error('Exact proof unavailable; no replacement');}};
  for(let i=0;i<3;i++){const before=seen.length;assert.equal(await recoverSavedRewardPayouts({store:f.reopen(),chain}),0);assert.equal(seen.length-before,32);}
  assert.equal(new Set(seen.slice(0,65)).size,65);
  const after=(await f.store.read()).schedules;for(const p of f.plans){assert.deepEqual(after[p.id].payoutAttempts,original[p.id].payoutAttempts);assert.deepEqual(after[p.id].payments,{});}
});

test('unknown recovery records one durable error batch without replacing signed attempts',async t=>{
  const f=await fixture(t,[33]),original=(await f.store.read()).schedules[f.plans[0].id].payoutAttempts;
  let transactions=0,calls=0;
  const store={read:()=>f.store.read(),transaction:mutator=>{transactions++;return f.store.transaction(mutator);}};
  await recoverSavedRewardPayouts({store,chain:{submitLeaf:async(_plan,_leaf,options)=>{
    assert.equal(options.recoveryOnly,true);calls++;throw Error('Exact proof unavailable');}}});
  assert.equal(calls,32);assert.equal(transactions,2,'One cursor and one error publication for a bounded page.');
  const row=(await f.reopen().read()).schedules[f.plans[0].id];
  assert.deepEqual(row.payoutAttempts,original);assert.equal(row.payoutRecoveryError,'Exact proof unavailable');
});

test('failed error batch leaves every saved attempt unchanged and surfaces the disk error',async t=>{
  const f=await fixture(t,[33]),original=(await f.store.read()).schedules[f.plans[0].id].payoutAttempts;
  let transactions=0,calls=0;
  const store={read:()=>f.store.read(),transaction:mutator=>{
    if(++transactions===2)throw Error('Error batch disk write refused');return f.store.transaction(mutator);
  }};
  await assert.rejects(recoverSavedRewardPayouts({store,chain:{submitLeaf:async(_plan,_leaf,options)=>{
    assert.equal(options.recoveryOnly,true);calls++;throw Error('Exact proof unavailable');}}}),/Error batch disk write refused/);
  assert.equal(calls,32);assert.equal(transactions,2);
  assert.deepEqual((await f.reopen().read()).schedules[f.plans[0].id].payoutAttempts,original);
});

test('paused and throwing scheduler readiness still performs only bounded read-only saved recovery',async t=>{
  const f=await fixture(t);let calls=0,throws=false,fresh=0;
  const chain={cluster:'devnet',readiness:async()=>{if(throws)throw Error('Readiness unavailable');return{constrainedPayouts:false,reasons:['protocol-paused']};},
    submitLeaf:async(_plan,_leaf,options)=>{assert.equal(options.recoveryOnly,true);calls++;throw Error('Proof unavailable');},ensureCycle:async()=>{fresh++;throw Error('No fresh signing');}};
  const scheduler=()=>createRewardScheduler({store:f.reopen(),chain});
  const result=await scheduler().execute(200);assert.equal(result.submitted,0);assert.equal(result.status,'unavailable');assert.equal(calls,32);
  throws=true;await assert.rejects(scheduler().execute(200),/Readiness unavailable/);assert.equal(calls,64);assert.equal(fresh,0);
});

test('explicit selected schedule IDs constrain recovery before applying the shared work bound',async t=>{
  const f=await fixture(t);let calls=0;
  const chain={submitLeaf:async(plan,_leaf,options)=>{assert.equal(plan.id,'schedule-1');assert.equal(options.recoveryOnly,true);calls++;throw Error('Pending');}};
  await recoverSavedRewardPayouts({store:f.store,chain,selected:new Set(['schedule-1'])});assert.equal(calls,32);
  await recoverSavedRewardPayouts({store:f.store,chain,selected:new Set(['absent'])});assert.equal(calls,32);
});

test('competing store instances select disjoint initial recovery pages under the same lock',async t=>{
  const f=await fixture(t),[a,b]=await Promise.all([selectRewardPayoutRecoveries({store:f.store}),selectRewardPayoutRecoveries({store:f.reopen()})]);
  assert.equal(a.length,32);assert.equal(b.length,32);assert.equal(new Set([...a,...b].map(x=>taskKey(x.plan,x.leaf))).size,64);
});

test('small cached recovery sets do not introduce a ledger cursor write',async t=>{
  const f=await fixture(t,[3]);let writes=0;
  const rows=await selectRewardPayoutRecoveries({store:{read:()=>f.store.read(),transaction:()=>{writes++;throw Error('No cursor write for small set');}}});
  assert.equal(rows.length,3);assert.equal(writes,0);
});

test('cursor persistence failure prevents calls and preserves every original marker',async t=>{
  const f=await fixture(t),before=await f.store.read();let calls=0;
  await assert.rejects(recoverSavedRewardPayouts({store:{read:()=>f.store.read(),transaction:async()=>{throw Error('Disk write refused');}},
    chain:{submitLeaf:async()=>{calls++;}}}),/Disk write refused/);
  assert.equal(calls,0);assert.deepEqual(await f.store.read(),before);
});

test('corrupt recovery cursor cannot fall through to unbounded or fresh work',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.rewardPayoutRecoveryCursor={version:1,after:'not-a-canonical-task'};});let calls=0;
  await assert.rejects(recoverSavedRewardPayouts({store:f.store,chain:{submitLeaf:async()=>{calls++;}}}));assert.equal(calls,0);
});

test('concurrently removed original attempt stays recovery-only and is conservatively retained',async t=>{
  const f=await fixture(t),original=f.plans[0].payoutAttempts;let changed=false;
  const chain={submitLeaf:async(plan,leaf,options)=>{assert.equal(options.recoveryOnly,true);if(!changed){changed=true;await f.store.transaction(s=>{delete s.schedules[plan.id].payoutAttempts[leaf.recipient];});}
    throw Error('No new attempt authorized');}};
  await recoverSavedRewardPayouts({store:f.store,chain});assert.deepEqual((await f.store.read()).schedules[f.plans[0].id].payoutAttempts,original);
});

test('measure full manifest lock work and bounded recovery ledger writes across two injected cohorts',async t=>{
  const f=await fixture(t,[1001,1001]);let counters;
  const reset=()=>{counters={publicReads:0,transactions:0,serializedCandidateBytes:0,actualLedgerReplacements:0,actualLedgerWriteBytes:0,mutatorInsideLockMs:0,transactionElapsedMs:0,instrumentationSerializeMs:0};};reset();
  const measured={read:async()=>{counters.publicReads++;return f.store.read();},transaction:async mutator=>{const before=await stat(f.path,{bigint:true}),start=performance.now();assert(before.ino>0n);
    try{return await f.store.transaction(async state=>{const lockStart=performance.now(),result=await mutator(state);counters.mutatorInsideLockMs+=performance.now()-lockStart;
      const cost=performance.now();counters.serializedCandidateBytes+=Buffer.byteLength(JSON.stringify(state));counters.instrumentationSerializeMs+=performance.now()-cost;return result;});}
    finally{const after=await stat(f.path,{bigint:true});if(after.ino!==before.ino){counters.actualLedgerReplacements++;counters.actualLedgerWriteBytes+=Number(after.size);}
      counters.transactions++;counters.transactionElapsedMs+=performance.now()-start;}}};
  let start=performance.now();assert.equal((await selectHolderPayoutPage({store:measured,plan:f.plans[0]})).length,32);
  assert.equal(counters.actualLedgerReplacements,1);const fresh={...counters,elapsedMs:performance.now()-start};reset();let calls=0;start=performance.now();
  await recoverSavedRewardPayouts({store:measured,chain:{submitLeaf:async(_plan,_leaf,options)=>{assert(options.recoveryOnly);calls++;throw Error('Synthetic missing proof');}}});
  assert.equal(calls,32);assert.equal(counters.publicReads,1);assert.equal(counters.transactions,2);
  const metrics={scope:'synthetic-two-injected-1001-cohorts-no-financial-finality',node:process.version,cohorts:2,leavesPerCohort:1001,
    fresh,recovery:{...counters,elapsedMs:performance.now()-start,interfaceCalls:calls},maxRssKiB:process.resourceUsage().maxRSS,networkCalls:0,transactionsSent:0,
    limitation:'Mutator timing is inside the actual lock; transaction time includes queue/read/serialize/fsync/rename/unlock. Byte counting adds measured JSON instrumentation overhead; stat observers add I/O. Physical ledger replacements exclude lock-file metadata. Attempts are marker-only, not full signed payloads. Whole-ledger O(N) remains.'};
  if(process.env.FUNDED_RECOVERY_METRICS_PATH){const path=resolve(process.env.FUNDED_RECOVERY_METRICS_PATH),root=resolve(process.cwd());
    assert(path.startsWith(root+sep)&&basename(path).startsWith('tmp-reward-recovery-metrics'));await appendFile(path,JSON.stringify(metrics)+'\n');}
  t.diagnostic(JSON.stringify(metrics));assert.equal(counters.actualLedgerReplacements,2);
});


test('unselected malformed schedules do not block selected saved-attempt recovery',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.schedules['schedule-0'].manifest=null;});let calls=0;
  await recoverSavedRewardPayouts({store:f.store,selected:new Set(['schedule-1']),chain:{submitLeaf:async(plan,_leaf,options)=>{
    assert.equal(plan.id,'schedule-1');assert(options.recoveryOnly);calls++;throw Error('Pending exact proof');}}});assert.equal(calls,32);
});


test('duplicate task identities are refused before any saved-attempt call',async t=>{
  const f=await fixture(t);await f.store.transaction(s=>{s.schedules['duplicate-map-key']=structuredClone(s.schedules['schedule-0']);});let calls=0;
  await assert.rejects(recoverSavedRewardPayouts({store:f.store,chain:{submitLeaf:async()=>{calls++;}}}),/duplicate saved payout recovery task/);assert.equal(calls,0);
});


test('filtered recovery cannot rewind full-queue progress across process-style store reopens',async t=>{
  const f=await fixture(t,[64,64]),seen=new Set(),b=new Set();
  for(let i=0;i<12;i++){
    const page=await selectRewardPayoutRecoveries({store:f.reopen()});assert.equal(page.length,32);
    for(const x of page){seen.add(taskKey(x.plan,x.leaf));if(x.plan.id==='schedule-1')b.add(x.leaf.index);}
    const before=(await f.store.read()).rewardPayoutRecoveryCursor;
    const filtered=await selectRewardPayoutRecoveries({store:f.reopen(),selected:new Set(['schedule-0'])});assert.equal(filtered.length,32);
    assert(filtered.every(x=>x.plan.id==='schedule-0'));assert.deepEqual((await f.store.read()).rewardPayoutRecoveryCursor,before);
  }
  assert.equal(seen.size,128);assert.equal(b.size,64);
});

test('overlapping filtered requests collectively progress every eligible schedule without starvation',async t=>{
  for(const pattern of [[[0,1,2],[0]],[[0,1],[1,2]]]){
    const f=await fixture(t,[64,64,64]),seen=new Map(f.plans.map(p=>[p.id,new Set()]));
    for(let i=0;i<24;i++)for(const members of pattern){
      const ids=new Set(members.map(n=>'schedule-'+n)),page=await selectRewardPayoutRecoveries({store:f.reopen(),selected:ids});assert.equal(page.length,32);
      for(const x of page){assert(ids.has(x.plan.id));seen.get(x.plan.id).add(x.leaf.index);}
    }
    for(const values of seen.values())assert.equal(values.size,64);
    assert.equal((await f.store.read()).rewardPayoutRecoveryCursor,undefined);
  }
});

test('competing filtered stores preserve per-schedule leaf progress and leave the full cursor untouched',async t=>{
  const f=await fixture(t,[64,64]),selected=new Set(f.plans.map(p=>p.id));
  const [a,b]=await Promise.all([selectRewardPayoutRecoveries({store:f.store,selected}),selectRewardPayoutRecoveries({store:f.reopen(),selected})]);
  assert.equal(new Set([...a,...b].map(x=>taskKey(x.plan,x.leaf))).size,64);
  const original=[...a,...b].filter(x=>x.plan.id==='schedule-0');assert.equal(original.length,32);
  const next=await selectRewardPayoutRecoveries({store:f.reopen(),selected:new Set(['schedule-0'])});
  assert.equal(new Set([...original,...next].map(x=>x.leaf.index)).size,64);
  assert.equal((await f.store.read()).rewardPayoutRecoveryCursor,undefined);
});

test('arbitrary filtered subsets store only one progress record per existing schedule',async t=>{
  const f=await fixture(t,[33,33,33,33,33,33]),before=await f.store.read(),rootKeys=Object.keys(before);
  for(let round=0;round<2;round++)for(let mask=1;mask<64;mask++){
    const selected=new Set(f.plans.filter((_,i)=>mask&(1<<i)).map(p=>p.id));assert.equal((await selectRewardPayoutRecoveries({store:f.reopen(),selected})).length,32);
  }
  const saved=await f.store.read();assert.equal(Object.keys(saved.schedules).length,6);
  assert.deepEqual(Object.keys(saved).filter(k=>!rootKeys.includes(k)),['rewardPayoutFilteredSequence']);
  for(const row of Object.values(saved.schedules)){
    assert.deepEqual(Object.keys(row).filter(k=>!Object.hasOwn(before.schedules[row.id],k)),['filteredPayoutRecoveryCursor']);
    assert.deepEqual(row.payoutAttempts,before.schedules[row.id].payoutAttempts);
    assert.equal(row.filteredPayoutRecoveryCursor.version,1);
  }
});

test('invalid filtered progress refuses recovery without resetting or rewriting its state',async t=>{
  for(const field of ['missing-sequence','future-service','foreign-plan','bad-root-sequence']){
    const f=await fixture(t,[64]),selected=new Set(['schedule-0']);await selectRewardPayoutRecoveries({store:f.store,selected});
    await f.store.transaction(s=>{const p=s.schedules['schedule-0'].filteredPayoutRecoveryCursor;
      if(field==='missing-sequence')delete p.servedAt;if(field==='future-service')p.servedAt=s.rewardPayoutFilteredSequence+1;
      if(field==='foreign-plan')p.after=JSON.stringify(['different',0,keys[0]]);if(field==='bad-root-sequence')s.rewardPayoutFilteredSequence='bad';});
    const before=await f.store.read();await assert.rejects(selectRewardPayoutRecoveries({store:f.reopen(),selected}));assert.deepEqual(await f.store.read(),before);
  }
});
