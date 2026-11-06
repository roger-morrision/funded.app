import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcceptanceRunGuard} from '../scripts/devnet-acceptance-run-guard.mjs';

test('an exception after submission cannot cause a second launch',async()=>{
 let calls=0;
 const run=createAcceptanceRunGuard(async()=>{calls++;throw new Error('Evidence file unavailable after broadcast');});
 await assert.rejects(run({}),/Evidence file/);
 await assert.rejects(run({}),/reconciliation/);
 assert.equal(calls,1);
});
test('known launch and uncertain receipts block another run, while a pre-submission failure can retry',async()=>{
 for(const evidence of [
  {status:'passed',transactions:[{name:'v3-launch',finalized:true}]},
  {status:'blocked',transactions:[{name:'buy',finalized:false}]},
  {status:'blocked',transactions:[],launchJournal:{signature:'submitted'}},
 ]){
  let calls=0;const run=createAcceptanceRunGuard(async()=>{calls++;return evidence;});
  assert.equal(await run({}),evidence);await assert.rejects(run({}),/reconciliation/);assert.equal(calls,1);
 }
 let calls=0;const run=createAcceptanceRunGuard(async()=>{calls++;return{status:'blocked',transactions:[]};});
 await run({});await run({});assert.equal(calls,2);
});
test('concurrent and incomplete attempts remain blocked until reconciled',async()=>{
 let release;const run=createAcceptanceRunGuard(()=>new Promise(resolve=>release=resolve));
 const first=run({});await assert.rejects(run({}),/reconciliation/);
 release(undefined);await assert.rejects(first,/incomplete/);await assert.rejects(run({}),/reconciliation/);
});
