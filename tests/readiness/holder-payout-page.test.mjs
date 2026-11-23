import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {buildRewardManifest,verifyRewardProof} from '../../reward-merkle.js';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {selectHolderPayoutPage} from '../../server/holder-payout-page.mjs';
import {payRewardSchedule} from '../../server/reward-schedule-payments.mjs';
import {createRewardScheduler} from '../../server/reward-scheduler.mjs';

// Public recipients from deterministic in-memory unit keys; no key files/RPC.
const recipients=Array.from({length:1002},(_,i)=>String(Keypair.fromSeed(createHash('sha256').update('holder-page-unit:'+i).digest()).publicKey));
async function fixture(t,asset='SOL',count=1001){
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'funded-holder-page-'));
  t.after(async()=>{const target=await realpath(dir);assert.equal(target,resolve(dir));assert.ok(target.startsWith(base+sep));await rm(target,{recursive:true,force:true});});
  const path=join(dir,'ledger.json'),store=createAutomaticRewardStore(path);
  const manifest=buildRewardManifest({cycleId:'37'.repeat(32),asset,allocations:recipients.slice(0,count).map((recipient,i)=>({recipient,amount:String(i+1)}))});
  const plan={id:'holder-page',kind:'holder',mint:recipients[1001],cluster:'devnet',asset,cutoffAt:100,payoutAt:200,status:'distributing',cycle:recipients[1000],manifest,payments:{}};
  await store.transaction(s=>{s.schedules={[plan.id]:structuredClone(plan)};});
  return {store,plan,reopen:()=>createAutomaticRewardStore(path)};
}
for(const asset of ['SOL',recipients[999]])test(`1001 global ${asset==='SOL'?'SOL':'paired'} entitlements finish in bounded restartable scheduler pages`,async t=>{
  const f=await fixture(t,asset),settled=new Map();let calls=0,rounds=0,store=f.store;
  // Models an attributed result at the existing submitLeaf interface, not an RPC
  // authenticator or chain outcome; those financial gates remain separate.
  const chain={cluster:'devnet',submitLeaf:async(plan,leaf,options)=>{
    assert.equal(options.store,store);assert(verifyRewardProof({...leaf,cycleId:plan.manifest.cycleId,asset,root:plan.manifest.root}));calls++;
    const prior=settled.has(leaf.index);if(!prior)settled.set(leaf.index,leaf.amount);
    return {signature:'mocked-finalized-'+leaf.index,finalized:true,balanceDeltaVerified:true,amountReceived:leaf.amount,alreadyPaid:prior};
  }};
  const start=performance.now();
  while(settled.size<1001){
    const before=calls;await payRewardSchedule({store,chain,plan:f.plan,batch:false});assert(calls-before<=32);assert(calls-before>0);
    rounds++;store=f.reopen();assert(rounds<=32);
  }
  assert.equal(rounds,32);assert.equal(calls,1001);assert.equal(settled.get(1000),'1001');
  assert.equal(String([...settled.values()].reduce((n,v)=>n+BigInt(v),0n)),f.plan.manifest.totalAmount);
  const saved=await store.read();assert.equal(Object.values(saved.schedules[f.plan.id].payments).filter(r=>r.status==='paid').length,1001);
  assert.deepEqual(saved.schedules[f.plan.id].manifest,f.plan.manifest);
  assert.equal(await payRewardSchedule({store,chain,plan:f.plan,batch:false}),0);assert.equal(calls,1001);
  t.diagnostic(JSON.stringify({scope:'synthetic-result-interface-not-financial-or-live-scale-proof',asset:asset==='SOL'?'SOL':'paired',recipients:1001,rounds,calls,elapsedMs:performance.now()-start,maxRssKiB:process.resourceUsage().maxRSS}));
});

test('unknown first page does not starve later leaves or replace its original signed attempt',async t=>{
  const f=await fixture(t,'SOL',65);let calls=0;const pending={state:'prepared',signature:'original-unknown'};
  await f.store.transaction(s=>{s.schedules[f.plan.id].payoutAttempts={[recipients[0]]:pending};});
  const chain={cluster:'devnet',submitLeaf:async(_plan,leaf)=>{calls++;if(leaf.index===0)throw Error('Original attempt unresolved; no replacement');
    return {signature:'mocked-'+leaf.index,finalized:true,balanceDeltaVerified:true,amountReceived:leaf.amount};}};
  await payRewardSchedule({store:f.store,chain,plan:f.plan,batch:false});assert.equal(calls,32);
  const reopened=f.reopen();await payRewardSchedule({store:reopened,chain,plan:f.plan,batch:false});assert.equal(calls,64);
  const row=(await reopened.read()).schedules[f.plan.id];assert.deepEqual(row.payoutAttempts[recipients[0]],pending);
  assert.equal(Object.values(row.payments).filter(p=>p.status==='paid').length,63);assert.equal(row.payments[recipients[0]].status,'verification-pending');
});

test('crash after page selection defers work but preserves all global entitlements for the next round',async t=>{
  const f=await fixture(t,'SOL',65),first=await selectHolderPayoutPage({store:f.store,plan:f.plan});assert.equal(first.length,32);
  const second=await selectHolderPayoutPage({store:f.reopen(),plan:f.plan}),third=await selectHolderPayoutPage({store:f.reopen(),plan:f.plan});
  assert.equal(second[0].index,32);assert.equal(third[0].index,64);
  assert(new Set([...first,...second,...third].map(l=>l.index)).size===65);assert.deepEqual((await f.store.read()).schedules[f.plan.id].manifest,f.plan.manifest);
});

test('two locked-store selectors cannot claim the same initial page and restart preserves cursor',async t=>{
  const f=await fixture(t,'SOL',100),[a,b]=await Promise.all([selectHolderPayoutPage({store:f.store,plan:f.plan}),selectHolderPayoutPage({store:f.reopen(),plan:f.plan})]);
  assert.equal(new Set([...a,...b].map(l=>l.index)).size,64);
  assert.equal((await selectHolderPayoutPage({store:f.reopen(),plan:f.plan}))[0].index,64);
});

test('changed immutable schedule and corrupt cursor fail before selecting fresh work',async t=>{
  for(const field of ['root','index','amounts','proof','payoutAt','cursor','cluster']){
    const f=await fixture(t,'SOL',3);await selectHolderPayoutPage({store:f.store,plan:f.plan});
    await f.store.transaction(s=>{const r=s.schedules[f.plan.id];if(field==='root')r.manifest.root='00'.repeat(32);if(field==='index')r.manifest.leaves[1].index=0;
      if(field==='amounts'){
        const first=r.manifest.leaves[0].amount;r.manifest.leaves[0].amount=r.manifest.leaves[1].amount;r.manifest.leaves[1].amount=first;
      }
      if(field==='proof')r.manifest.leaves[1].proof[0]='00'.repeat(32);
      if(field==='payoutAt')r.payoutAt++;if(field==='cursor')r.holderPayoutCursor.nextIndex=3;if(field==='cluster')r.cluster='mainnet-beta';});
    await assert.rejects(selectHolderPayoutPage({store:f.reopen(),plan:f.plan}));
  }
});

test('manifest change while waiting for the ledger lock cannot select from a stale validated plan',async t=>{
  const f=await fixture(t,'SOL',3),other=f.reopen();
  const delayed={transaction:async mutator=>{
    await other.transaction(state=>{
      const leaves=state.schedules[f.plan.id].manifest.leaves;
      [leaves[0].amount,leaves[1].amount]=[leaves[1].amount,leaves[0].amount];
    });
    return f.store.transaction(mutator);
  }};
  await assert.rejects(selectHolderPayoutPage({store:delayed,plan:f.plan}),/Holder page schedule changed/);
  assert.equal((await f.store.read()).schedules[f.plan.id].holderPayoutCursor,undefined);
});

test('page and isolated cohort bounds cannot be widened by caller input',async t=>{
  const f=await fixture(t,'SOL',3);
  for(const limit of [0,33,1.5])await assert.rejects(selectHolderPayoutPage({store:f.store,plan:f.plan,limit}));
  const large=await fixture(t,'SOL',1002);await assert.rejects(selectHolderPayoutPage({store:large.store,plan:large.plan}),/Bounded immutable/);
});


test('actual scheduler preserves partial status across bounded selected-ID runs and read-only unavailable states',async t=>{
  const f=await fixture(t,'SOL',65);let ready=true,throws=false,calls=0;
  const chain={cluster:'devnet',readiness:async()=>{if(throws)throw Error('Readiness unavailable');return{constrainedPayouts:ready,reasons:ready?[]:['protocol-paused']};},
    ensureCycle:async plan=>({address:plan.cycle,receiptMode:'legacy'}),submitLeaf:async(_plan,leaf)=>{calls++;return{signature:'mocked-'+leaf.index,finalized:true,balanceDeltaVerified:true,amountReceived:leaf.amount};}};
  const scheduler=()=>createRewardScheduler({store:f.reopen(),chain});
  assert.equal((await scheduler().execute(200,[f.plan.id])).submitted,32);assert.equal((await f.store.read()).schedules[f.plan.id].status,'distributing');
  ready=false;assert.equal((await scheduler().execute(200,[f.plan.id])).submitted,0);assert.equal(calls,32);
  throws=true;await assert.rejects(scheduler().execute(200,[f.plan.id]),/Readiness unavailable/);assert.equal(calls,32);
  throws=false;ready=true;assert.equal((await scheduler().execute(200,['unselected'])).submitted,0);assert.equal(calls,32);
  assert.equal((await scheduler().execute(200,[f.plan.id])).submitted,32);assert.equal((await scheduler().execute(200,[f.plan.id])).submitted,1);
  assert.equal((await f.store.read()).schedules[f.plan.id].status,'paid');assert.equal((await scheduler().execute(200,[f.plan.id])).submitted,0);assert.equal(calls,65);
});


test('Devnet batching remains four leaves per transaction inside the bounded work page',async t=>{
  const f=await fixture(t,'SOL',65),groups=[];
  const chain={cluster:'devnet',submitLeaves:async(_plan,leaves)=>{groups.push(leaves.length);return leaves.map(leaf=>({leaf,result:{signature:'mocked-batch-'+leaf.index,
    finalized:true,balanceDeltaVerified:true,amountReceived:leaf.amount}}));}};
  assert.equal(await payRewardSchedule({store:f.store,chain,plan:f.plan,batch:true}),32);
  assert.deepEqual(groups,[4,4,4,4,4,4,4,4]);assert.equal((await f.store.read()).schedules[f.plan.id].holderPayoutCursor.nextIndex,32);
});
