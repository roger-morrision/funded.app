import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {mixedCapacityCohort,installCapacityBank,landCapacityLeaf} from './reward-capacity-mixed-fixture.mjs';
import {signedCapacityCohort} from './reward-capacity-fixture.mjs';
import {expiryExecutionStore} from './reward-expiry-execution-fixture.mjs';
import {createAutomaticRewardStore} from '../../server/automatic-reward-store.mjs';
import {recoverSavedRewardPayouts} from '../../server/reward-payout-recovery.mjs';
import {capacityWorkerComponents,capacityProgram} from './reward-capacity-workload.mjs';
import {writeCapacityBundle,readCapacityBundle} from './reward-capacity-bundle.mjs';

for(const assetName of ['SOL','USDC','Token2022'])test('mixed capacity '+assetName+' derives proofs and preserves paid metadata and unknowns across byte-copy restore',async t=>{
  const c=await mixedCapacityCohort({count:9,assetName}),{plan,f}=c;assert.equal(c.mixedProfile.verified,5);assert.equal(c.mixedProfile.prepared,4);
  const {path}=await expiryExecutionStore(t,{plan}),store=createAutomaticRewardStore(path),attempts=structuredClone(plan.payoutAttempts),payments=structuredClone(plan.payments);
  const beforeSends=f.sends,beforeNonces=f.latestCalls;let lookups=0;const read=f.connection.getTransaction;
  f.connection.getTransaction=async(...args)=>{lookups++;return read(...args);};
  assert.equal(await recoverSavedRewardPayouts({store,chain:c.chain}),0);assert.equal(lookups,4,'Verified cached completions require no RPC.');
  const bytes=await readFile(path),hash=createHash('sha256').update(bytes).digest('hex'),restored=join(dirname(path),'restored.json');
  await writeFile(restored,bytes,{flag:'wx'});const fd=await open(restored,'r+');try{await fd.sync();}finally{await fd.close();}
  assert.equal(createHash('sha256').update(await readFile(restored)).digest('hex'),hash);
  const reopened=createAutomaticRewardStore(restored);assert.equal(await recoverSavedRewardPayouts({store:reopened,chain:c.chain}),0);
  const row=(await reopened.read()).schedules[plan.id];assert.deepEqual(row.payoutAttempts,attempts);assert.deepEqual(row.payments,payments);
  assert.equal(f.sends,beforeSends);assert.equal(f.latestCalls,beforeNonces);assert.equal(lookups,8);
});

test('mixed capacity does not manufacture a verified proof from inconsistent transaction-local native effects',async()=>{
  const c=await signedCapacityCohort({count:3,assetName:'USDC'});installCapacityBank(c);
  const leaf=c.plan.manifest.leaves[0],tx=landCapacityLeaf(c,leaf);tx.meta.fee++;
  const state={schedules:{[c.plan.id]:c.plan}},store={read:async()=>state,transaction:async mutate=>mutate(state)};
  await assert.rejects(c.chain.submitLeaf(c.plan,leaf,{store,recoveryOnly:true}),/exact finalized reconciliation/);
  assert.equal(c.plan.payoutAttempts[leaf.recipient].state,'prepared');assert.equal(c.plan.payoutAttempts[leaf.recipient].proof,undefined);
  assert.equal(c.f.sends,3);assert.equal(c.f.latestCalls,3);
});

test('mixed capacity requires both prepared and verified cohorts to have a bounded declared stride',async()=>{
  for(const verifiedStride of [0,1,1.5,33])await assert.rejects(mixedCapacityCohort({count:3,assetName:'SOL',verifiedStride}));
});

test('mixed scheduler components and checksum-bound public bank restore preserve original paid and unknown records',async t=>{
  const cohorts=[await mixedCapacityCohort({count:9,assetName:'SOL'}),await mixedCapacityCohort({count:9,assetName:'USDC'})];
  const {path,store}=await expiryExecutionStore(t,{plan:cohorts[0].plan});
  await store.transaction(s=>{s.schedules=Object.fromEntries(cohorts.map(c=>[c.plan.id,c.plan]));s.programs[cohorts[0].plan.mint]=capacityProgram(cohorts[0].plan.mint);});
  const first=await capacityWorkerComponents({store,cohorts});assert.equal(first.captures,1);assert.equal(first.submitInterfaces,26);
  const directory=join(dirname(path),'public-bundle'),hash=await writeCapacityBundle(directory,await readFile(path),cohorts);
  await assert.rejects(readCapacityBundle(directory,'0'.repeat(64)),/checksum/);
  const bundle=await readCapacityBundle(directory,hash),restored=join(dirname(path),'worker-restored.json');
  await writeFile(restored,bundle.ledgerBytes,{flag:'wx'});const fd=await open(restored,'r+');try{await fd.sync();}finally{await fd.close();}
  const result=await capacityWorkerComponents({store:createAutomaticRewardStore(restored),cohorts:bundle.cohorts,now:200041});
  assert.equal(result.execution.submitted,0);assert.equal(result.captures,1);assert.equal(result.submitInterfaces,26);
  await writeFile(join(directory,'bank.json'),Buffer.from('damaged'));
  await assert.rejects(readCapacityBundle(directory,hash));
});
