import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkerLifecycle, WorkerStoppingError } from '../scripts/worker-lifecycle.mjs';

test('SIGTERM wakes long idle waits, denies new admission and retains repeated-signal protection until disposal', async () => {
  const signals = new EventEmitter(), logs = [];
  const lifecycle = createWorkerLifecycle({ name:'fixture', signals, logger:{log:line=>logs.push(JSON.parse(line))} });
  lifecycle.assertRunning();
  const waits = [lifecycle.wait(300_000), lifecycle.wait(60_000)];
  signals.emit('SIGTERM'); signals.emit('SIGINT'); signals.emit('SIGTERM');
  await Promise.all(waits); await lifecycle.wait(300_000);
  assert(lifecycle.stopped); assert.throws(()=>lifecycle.assertRunning(), WorkerStoppingError);
  assert.equal(signals.listenerCount('SIGTERM'),1); assert.equal(signals.listenerCount('SIGINT'),1);
  assert.equal(logs.length,1);
  lifecycle.dispose();
  assert.equal(signals.listenerCount('SIGTERM'),0); assert.equal(signals.listenerCount('SIGINT'),0);
  assert.deepEqual(logs.map(row=>row.event),['worker_shutdown_started','worker_shutdown_finished']);
});

test('normal cleanup removes listeners and wakes unused waits without claiming signal shutdown', async () => {
  const signals = new EventEmitter(), logs=[];
  const lifecycle=createWorkerLifecycle({signals,logger:{log:line=>logs.push(line)}});
  const pending=lifecycle.wait(300_000); lifecycle.dispose(); await pending;
  assert.equal(signals.listenerCount('SIGTERM'),0); assert.deepEqual(logs,[]);
});

// Real worker entrypoints and real existing10s buyback startup wait. Every fetch
// is intercepted BEFORE the worker loads; unknown calls fail the fixture. This
// tests admission/awaiting/error logging, not a financial or actual OS-signal flow.
test('actual workers await admitted reads/writes through repeated signals and never start the next request', {timeout:20_000}, async () => {
  const temporary=await mkdtemp(join(tmpdir(),'funded-worker-stop-'));
  assert.equal(dirname(temporary),tmpdir()); assert(basename(temporary).startsWith('funded-worker-stop-'));
  try {
    const preload=join(temporary,'preload.mjs'), token=join(temporary,'token');
    await writeFile(token,'fixture-not-a-credential');
    await writeFile(preload,`
const job=process.env.FUNDED_STOP_TEST_CASE;
const trace=value=>console.log(JSON.stringify({fixture:value}));
const mint='1'.repeat(32), signature='2'.repeat(64);
const row={mint,status:'queued',amountLamports:'10000',sourceCollectionSignature:signature};
const response=data=>({ok:true,status:200,json:async()=>data});
const finish=async()=>{
  trace('admitted');
  process.emit('SIGTERM');process.emit('SIGINT');process.emit('SIGTERM');
  trace('signals-delivered');
  await new Promise(resolve=>setTimeout(resolve,80));
  trace('admitted-settled');
  if(job.endsWith('uncertain')||job.endsWith('heartbeat-error'))throw Error('fixture uncertain request; inspect existing server journal');
};
globalThis.fetch=async(target,options={})=>{
  const path=new URL(target).pathname,method=options.method||'GET'; trace(method+' '+path);
  if(path==='/api/keeper/collection-candidates'){
    if(job==='fee-read')await finish();
    return response({cluster:'devnet',mints:[{mint},{mint:'3'.repeat(32)}]});
  }
  if(path.endsWith('/fee-activity')){
    if(job==='fee-detail-read')await finish();
    return response({overview:{available:true,pump:{status:'confirmed',accruedLamports:'1000000000'}}});
  }
  if(path==='/api/keeper/collect'&&method==='POST'){
    await finish();return job.endsWith('json')?{json:async()=>{throw Error('fixture response-json unavailable; uncertain server work');}}:response({scope:'per-mint-v3',status:'collected',onchainVerified:true,signature});
  }
  if(path==='/api/buyback/status'){
    if(job==='buyback-read')await finish();
    return response({cluster:'devnet',pending:job.includes('heartbeat')?[]:[row,{...row,mint:'3'.repeat(32)}],dashboard:{status:'verified',unindexedStatus:'verified',triggerReached:true}});
  }
  if(path.includes('/v3-buyback/')&&method==='POST'){
    await finish();return job.endsWith('json')?{json:async()=>{throw Error('fixture response-json unavailable; uncertain server work');}}:response({signature});
  }
  if(path==='/api/buyback/worker-heartbeat'&&method==='POST'&&job.includes('heartbeat')){await finish();return response({recorded:true});}
  trace('FORBIDDEN '+method+' '+path);throw Error('Unexpected request in shutdown fixture');
};
`);
    const cases=['fee-read','fee-detail-read','fee-write','fee-uncertain','fee-json',
      'buyback-read','buyback-write','buyback-uncertain','buyback-json','buyback-heartbeat','buyback-heartbeat-error'];
    const results=await Promise.allSettled(cases.map(async job=>{
      const fee=job.startsWith('fee');
      const {stdout,stderr}=await promisify(execFile)(process.execPath,['--import',pathToFileURL(preload).href,
        resolve(fee?'scripts/run-fee-collector.mjs':'scripts/run-v3-buyback-worker.mjs')],{
        timeout:16_000,env:{...process.env,NODE_OPTIONS:'',SOLANA_CLUSTER:'devnet',
          FUNDED_API_TOKEN:'fixture-not-a-credential',FUNDED_API_TOKEN_FILE:token,
          FUNDED_FEE_COLLECTION_API:'http://127.0.0.1:18987',FUNDED_INTERNAL_APP_URL:'http://127.0.0.1:18987',
          FUNDED_FEE_COLLECTION_PAUSED_MINTS:'',FUNDED_V3_BUYBACK_ENABLED:'true',FUNDED_STOP_TEST_CASE:job},
      });
      const lines=stdout.trim().split('\n').map(line=>JSON.parse(line)), trace=lines.filter(row=>row.fixture).map(row=>row.fixture);
      assert(trace.includes('admitted-settled'),job);
      assert(!trace.some(value=>value.startsWith('FORBIDDEN')),job);
      assert.equal(lines.filter(row=>row.event==='worker_shutdown_started').length,1,job);
      assert.equal(lines.at(-1).event,'worker_shutdown_finished',job);
      assert(trace.indexOf('admitted-settled')>trace.indexOf('signals-delivered'),job);
      const writes=trace.filter(value=>value.startsWith('POST '));
      assert.equal(writes.length,job.endsWith('read')?0:1,job);
      assert.equal(trace.filter(value=>value.includes('worker-heartbeat')).length,job.includes('heartbeat')?1:0,job);
      assert(!lines.some(row=>row.event==='v3_buyback_attempt'&&row.outcome==='finalized')||job==='buyback-write',job);
      if(job.endsWith('uncertain')||job.endsWith('heartbeat-error'))assert(stderr.includes('fixture uncertain request'),job);
      else if(job.endsWith('json'))assert(stderr.includes('fixture response-json unavailable'),job);
      else assert.equal(stderr,'',job);
    }));
    const failures=results.flatMap((row,index)=>row.status==='rejected'?[new Error(cases[index],{cause:row.reason})]:[]);
    if(failures.length)throw new AggregateError(failures,'Worker shutdown fixture failed');
  } finally { await rm(temporary,{recursive:true,force:true}); }
});
