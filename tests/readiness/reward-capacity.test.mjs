import test from 'node:test';
import assert from 'node:assert/strict';
import {signedCapacityCohort} from './reward-capacity-fixture.mjs';
import {requirePayoutAttempt} from '../../server/reward-payout-journal.mjs';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {recoverSavedRewardPayouts} from '../../server/reward-payout-recovery.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';

for(const assetName of ['SOL','USDC','Token2022'])test('capacity input '+assetName+' binds each actual signed wire to its global leaf and owned bank',async t=>{
  const c=await signedCapacityCohort({count:33,assetName}),{plan,options}=c;
  assert.equal(c.profile.uniqueSignatures,33);assert.equal(c.profile.uniqueWires,33);assert(c.profile.maxWire<=1232);
  const a=plan.manifest.leaves[0],b=plan.manifest.leaves[1];
  assert.throws(()=>requirePayoutAttempt(plan.payoutAttempts[a.recipient],{...options,plan,leaf:b}));
  const changed=structuredClone(plan.payoutAttempts[a.recipient]);changed.before.feeLamports++;
  assert.throws(()=>requirePayoutAttempt(changed,{...options,plan,leaf:a}));
  const {path}=await expiryExecutionStore(t,{plan}),store=createAutomaticRewardStore(path),original=structuredClone(plan.payoutAttempts);
  let calls=0;const beforeSends=c.f.sends,beforeNonces=c.f.latestCalls;
  const chain={submitLeaf:async(p,l,o)=>{assert.equal(o.recoveryOnly,true);calls++;return c.chain.submitLeaf(p,l,o);}};
  assert.equal(await recoverSavedRewardPayouts({store,chain}),0);assert.equal(calls,32);
  assert.equal(c.f.sends,beforeSends);assert.equal(c.f.latestCalls,beforeNonces);
  const reopened=await createAutomaticRewardStore(path).read();assert.deepEqual(reopened.schedules[plan.id].payoutAttempts,original);
  assert.deepEqual(reopened.schedules[plan.id].payments,{});
});

test('capacity fixture refuses unknown assets and undeclared cohort sizes before construction',async()=>{
  for(const count of [0,-1,1.5,1002])await assert.rejects(signedCapacityCohort({count,assetName:'SOL'}));
  await assert.rejects(signedCapacityCohort({count:1,assetName:'unknown'}));
});

test('competing asset cohorts retain different actual cycle PDAs rather than incompatible banks at one address',async()=>{
  const a=await signedCapacityCohort({count:1,assetName:'SOL'}),b=await signedCapacityCohort({count:1,assetName:'USDC'});
  assert.notEqual(a.plan.cycle,b.plan.cycle);assert.notEqual(a.plan.manifest.cycleId,b.plan.manifest.cycleId);
  for(const [address,info] of a.f.rows)if(b.f.rows.has(address)){
    const other=b.f.rows.get(address);assert.equal(String(info.owner),String(other.owner));
    assert(info.data.equals(other.data));assert.equal(info.lamports,other.lamports);assert.equal(info.executable,other.executable);
  }
});
