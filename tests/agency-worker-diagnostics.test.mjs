import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgencyDiagnostics,agencyErrorDiagnostics,agencyFailureCode} from '../server/agency-worker-diagnostics.mjs';

test('nested diagnostics preserve the original frozen error and identify the innermost timed failure',async()=>{
  let clock=0;const records=[],diagnostics=createAgencyDiagnostics({monotonicNow:()=>clock,onStep:row=>records.push(row)});
  const error=Object.freeze(Object.assign(new Error('secret URL and signed bytes'),{status:429}));
  await assert.rejects(()=>diagnostics.step('milestone',{},async()=>{
    clock+=10;return diagnostics.step('market-observation',{},async()=>{clock+=25;throw error;});
  }),actual=>actual===error);
  diagnostics.attach(error);
  const result=agencyErrorDiagnostics(error);
  assert.equal(result.cycleDurationMs,35);assert.equal(result.failure.phase,'market-observation');
  assert.equal(result.failure.elapsedMs,25);assert.equal(result.failure.reasonCode,'provider-rate-limited');
  assert.deepEqual(result.steps.map(row=>row.elapsedMs),[25,35]);
  assert.deepEqual(records.map(row=>row.outcome),['started','started','failed','failed']);
  assert.equal(new Set(records.map(row=>row.cycleId)).size,1);
  assert.doesNotMatch(JSON.stringify(result),/secret URL|signed bytes|stack|message/);
});

test('diagnostic output is bounded and allowlisted, including caller metadata and untrusted error codes',async()=>{
  const diagnostics=createAgencyDiagnostics();
  for(let i=0;i<140;i++)await diagnostics.step('private-url',{mint:'private-secret',agent:99,password:'private-password'},async()=>null);
  const result=diagnostics.snapshot();assert.equal(result.steps.length,128);assert.equal(result.droppedSteps,12);
  assert.doesNotMatch(JSON.stringify(result),/private-|password/);
  for(const error of [{code:'constructor',status:'429'},{message:'RPC 429 at secret URL'},{code:'secret-key'},{status:200}])
    assert.equal(agencyFailureCode(error),'verification-unavailable');
  assert.equal(agencyFailureCode({cause:{code:'UND_ERR_CONNECT_TIMEOUT',message:'secret'}}),'request-timeout');
  assert.equal(agencyFailureCode({cause:{code:'ECONNRESET'}}),'network-unavailable');
});

test('migration remains pending, telemetry failures cannot interrupt execution, and no action is retried',async()=>{
  let calls=0;
  for(const onStep of [()=>{throw new Error('logger failed');},async()=>{throw new Error('async logger failed');}]){
    const diagnostics=createAgencyDiagnostics({onStep});
    assert.equal(await diagnostics.step('custody',{},async()=>{calls++;return 123;}),123);
    await assert.rejects(()=>diagnostics.step('market-observation',{},async()=>{throw {code:'AGENCY_MARKET_NOT_MIGRATED'};}));
    assert.equal(diagnostics.snapshot().steps.at(-1).outcome,'pending');
  }
  assert.equal(calls,2);
});

test('reusing an error in another cycle cannot retain the previous cycle phase or timing',async()=>{
  const error=new Error('unavailable');
  for(const phase of ['custody','quote']){
    const diagnostics=createAgencyDiagnostics();
    await assert.rejects(()=>diagnostics.step(phase,{},async()=>{throw error;}));diagnostics.attach(error);
    assert.equal(agencyErrorDiagnostics(error).failure.phase,phase);
  }
});

test('a reused error in a later step replaces stale attribution while preserving nested failures',async()=>{
  const error=Object.freeze(new Error('unavailable')),diagnostics=createAgencyDiagnostics();
  for(const phase of ['custody','quote']){
    await assert.rejects(()=>diagnostics.step('milestone',{},()=>diagnostics.step(phase,{},async()=>{throw error;})));
    assert.equal(diagnostics.failure(error).phase,phase);
  }
});
