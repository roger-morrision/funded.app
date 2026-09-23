import assert from 'node:assert/strict';
import {receiptWorkerOutcome,receiptWorkerStatus} from '../server/receipt-worker-status.mjs';
const now=Date.now(),date=new Date(now).toISOString();
assert.equal(receiptWorkerStatus(null).status,'never-run');
const row={owner:'private-owner',expiresAt:now+120000,progress:{after:'private-cursor',passes:1,lastPass:{checked:12,verified:10,unresolved:2,finishedAt:date}},lastRun:{status:'running',startedAt:date,secret:'private-key'}};
const running=receiptWorkerStatus(row,{now});assert.equal(running.status,'running');assert.equal(running.coverageComplete,false);assert.doesNotMatch(JSON.stringify(running),/private-/);
assert.equal(receiptWorkerStatus(row,{now:now+120001}).status,'stalled');
assert.equal(receiptWorkerStatus({...row,owner:null,expiresAt:0},{now}).status,'stalled','A released lease cannot claim a running worker.');
for(const status of ['blocked','failed','aborted','batch-finished','pass-finished']){const released={...row,owner:null,expiresAt:0,lastRun:{status,startedAt:date,finishedAt:date,pages:2}};assert.equal(receiptWorkerStatus(released,{now}).status,status);assert.equal(receiptWorkerStatus(released,{now:now+300001}).status,'stale');}
assert.throws(()=>receiptWorkerOutcome({status:'pretend-success'}));
assert.equal(receiptWorkerStatus({progress:{checked:-1,verified:Infinity}}).currentPass.checked,0);
console.log('Receipt worker status: never-run, running, stalled, blocked/failed/aborted, stale, safe counts and secret redaction passed.');
