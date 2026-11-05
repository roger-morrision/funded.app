import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuybackHistoryReader} from '../server/buyback-history-cache.mjs';
test('slow history survives caller cancellation, coalesces scans, and expires independently of custody',async()=>{
  let finish,calls=0,now=100,signal;
  const reader=createBuybackHistoryReader({now:()=>now,connectionFactory:s=>{signal=s;return{};},
    read:async()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  const caller=new AbortController(),input={programId:'fixture',signal:caller.signal};
  const a=reader(input);await new Promise(resolve=>setImmediate(resolve));caller.abort();
  assert.equal(signal.aborted,false);assert.equal(reader(input),a);assert.equal(calls,1);
  await assert.rejects(reader({...input,programId:'other'}));
  finish({finalized:true,signature:'proof'});assert.equal((await a).signature,'proof');
  assert.equal(reader(input),a);now+=30_001;
  const b=reader(input);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
  finish(null);assert.equal(await b,null);
});
test('history has a hard deadline and errors are briefly cached without reporting empty history',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal,calls=0,now=0;
  const reader=createBuybackHistoryReader({timeoutMs:100,now:()=>now,connectionFactory:s=>{signal=s;return{};},
    read:()=>{calls++;return new Promise(()=>{});}});
  const a=reader({programId:'fixture'}),rejected=assert.rejects(a,/timed out/);
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(101);await rejected;
  assert(signal.aborted);await assert.rejects(reader({programId:'fixture'}));assert.equal(calls,1);
});
