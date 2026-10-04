// This exercise owns its Docker container and both databases. It never reads
// DATABASE_URL or accepts an existing database/container as a target.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { createXPostStore } from '../server/x-post-store.mjs';
import { runXPostWorker } from '../server/x-post-worker.mjs';

const args=process.argv.slice(2);
assert.ok(args[0]==='--run' && (args.length===1 || (args.length===3 && args[1]==='--report')),
  'Use --run [--report path]. Only a newly created disposable Docker PostgreSQL is allowed; existing database/container targets are rejected.');
const reportPath=args.length===3?resolve(args[2]):null;
const execute=promisify(execFile);
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const docker=async(...args)=>(await execute('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,timeout:60_000,maxBuffer:4*1024*1024})).stdout.trim();
// These settings apply only inside this disposable verifier process.
process.env.DATABASE_SSL='false';
delete process.env.DATABASE_CA_CERT;
delete process.env.DATABASE_CA_CERT_PATH;
const runId=randomUUID(),name=`funded-x-restore-${runId}`;
const sourceDb='funded_x_restore_source',targetDb='funded_x_restore_target',accountId='recovery_fixture';
const directory=await mkdtemp(join(tmpdir(),'funded-x-restore-'));
const stores=[],pools=[];
let containerId=null,outcome;
const began=performance.now();
const sha=value=>createHash('sha256').update(value).digest('hex');
const fixture=id=>({id,kind:'launch',cluster:'devnet',occurredAt:'2026-10-04T00:00:00.000Z',text:'Synthetic Devnet recovery fixture',proofs:{signature:'synthetic-only',slot:42}});
const publication={id:'987654321',url:'https://x.com/i/web/status/987654321'};
async function snapshot(pool){
  const result={};
  for(const table of ['x_post_accounts','x_post_outbox']) result[table]=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(row=>row.row);
  return result;
}
try{
  await docker('info','--format','{{.ServerVersion}}');
  const password=randomBytes(24).toString('hex');
  const envFile=join(directory,'postgres.env');
  await writeFile(envFile,`POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=${sourceDb}\n`,{mode:0o600});
  containerId=await docker('run','--detach','--name',name,'--label',`app.funded.x-recovery=${runId}`,'--env-file',envFile,'--publish','127.0.0.1::5432','postgres:17-alpine');
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const address=await docker('port',containerId,'5432/tcp');
  assert.match(address,/^127\.0\.0\.1:\d+$/);
  const port=Number(address.split(':')[1]);
  let ready=false;
  for(let attempt=0;attempt<80;attempt++){
    try{await docker('exec',containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d',sourceDb);ready=true;break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.ok(ready,'Disposable PostgreSQL must be ready over TCP.');
  const url=database=>{
    assert.ok([sourceDb,targetDb].includes(database));
    return `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
  };
  const poolFor=database=>{const pool=new pg.Pool({connectionString:url(database),connectionTimeoutMillis:5000});pools.push(pool);return pool;};
  const storeFor=async database=>{
    const store=createXPostStore({databaseUrl:url(database),accountId,minIntervalMs:1,leaseMs:60_000,maxHourlyPosts:3,maxDailyPosts:3});
    stores.push(store);await store.init();return store;
  };
  const source=await storeFor(sourceDb),sourcePool=poolFor(sourceDb);
  const events=['event:01-posted','event:02-uncertain','event:03-interrupted','event:04-pending'].map(fixture);
  const cursor={version:1,enabledAt:'2026-10-04T00:00:00.000Z',streams:{launches:{after:{id:'verified-last-event',at:1791072000000},pending:[]}}};
  await source.enqueueBatch(events,{cursor,version:0});
  const first=await source.claim();assert.equal(first.event.id,events[0].id);
  await source.markPosted(first.event.id,first.token,publication);
  await sourcePool.query("UPDATE x_post_accounts SET next_allowed_at=clock_timestamp()-interval '1 second'");
  const second=await source.claim();assert.equal(second.event.id,events[1].id);
  await source.markUncertain(second.event.id,second.token,'delivery-unknown');
  await sourcePool.query("UPDATE x_post_accounts SET next_allowed_at=clock_timestamp()-interval '1 second'");
  const interrupted=await source.claim();assert.equal(interrupted.event.id,events[2].id);
  await sourcePool.query("UPDATE x_post_accounts SET lease_expires_at=clock_timestamp()-interval '1 minute'");
  await sourcePool.query("UPDATE x_post_outbox SET lease_expires_at=clock_timestamp()-interval '1 minute' WHERE status='sending'");
  const before=await snapshot(sourcePool);
  assert.equal(before.x_post_accounts[0].day_count,3);
  await source.close();stores.splice(stores.indexOf(source),1);
  await sourcePool.end();pools.splice(pools.indexOf(sourcePool),1);

  const backupStarted=performance.now();
  await docker('exec',containerId,'pg_dump','-U','postgres','--format=custom','--no-owner','--no-acl','--file=/tmp/x-outbox.dump',sourceDb);
  const archive=join(directory,'x-outbox.dump');
  await docker('cp',`${containerId}:/tmp/x-outbox.dump`,archive);await chmod(archive,0o600);
  const archiveBytes=await readFile(archive),backupMs=Math.round(performance.now()-backupStarted);
  // Prove the restored database cannot fall back to a still-live source.
  await docker('exec',containerId,'dropdb','-U','postgres',sourceDb);
  await docker('exec',containerId,'createdb','-U','postgres','--template=template0',targetDb);
  const restoreStarted=performance.now();
  await docker('exec',containerId,'pg_restore','-U','postgres','--dbname',targetDb,'--single-transaction','--no-owner','--no-acl','/tmp/x-outbox.dump');
  const restoredPool=poolFor(targetDb);
  assert.deepEqual(await snapshot(restoredPool),before,'Every outbox/account field must restore exactly, including claims, caps, receipts and cursor.');
  const restoreMs=Math.round(performance.now()-restoreStarted);
  const [restored,replica]=await Promise.all([storeFor(targetDb),storeFor(targetDb)]);
  assert.deepEqual(await restored.readCursor(),{version:1,cursor});
  assert.deepEqual((await restored.list()).map(item=>item.status),['posted','uncertain','sending','pending']);
  assert.equal((await restored.enqueue(events[0])).status,'posted','Replay must preserve a restored publication receipt.');
  await assert.rejects(restored.enqueueBatch([fixture('event:should-rollback'),{...events[0],text:'Changed'}],{cursor:{changed:true},version:1}),/immutable/);
  assert.equal(await restored.has('event:should-rollback'),false);
  assert.deepEqual(await replica.readCursor(),{version:1,cursor});
  // Keep this synthetic budget check in its current window even when a CI run
  // straddles midnight. The exact restored timestamps were compared above.
  await restoredPool.query("UPDATE x_post_accounts SET hour_start=date_trunc('hour',clock_timestamp(),'UTC'),day_start=date_trunc('day',clock_timestamp(),'UTC')");
  assert.equal(await restored.claim(),null,'Restored budgets must still block pending work.');
  assert.equal((await replica.list({status:'uncertain'})).length,2,'Interrupted sending must become uncertain after restore.');
  assert.equal((await restored.list({status:'pending'}))[0].attempts,0);
  await assert.rejects(restored.markPosted(interrupted.event.id,interrupted.token,publication),/no longer current/);
  // Simulate the next permitted UTC window without sleeping or publishing.
  await restoredPool.query("UPDATE x_post_accounts SET hour_start=clock_timestamp()-interval '2 hours',day_start=clock_timestamp()-interval '2 days',next_allowed_at=clock_timestamp()-interval '1 second'");
  const published=[];
  const publish=async event=>{published.push(event.id);return publication;};
  await Promise.all([restored,replica].map(store=>runXPostWorker({store,publish,enabled:true,dryRun:false,maxPosts:4})));
  assert.deepEqual(published,[events[3].id],'Only the pending fixture may dispatch after restore; uncertain and posted entries must never resend.');
  assert.equal((await restored.list({status:'posted'})).length,2);
  assert.equal((await restored.list({status:'uncertain'})).length,2);
  outcome={observedAt:new Date().toISOString(),mode:'isolated Docker PostgreSQL backup/restore; mock publisher only',
    postgresVersion:await docker('exec',containerId,'postgres','--version'),imageId:await docker('inspect','--format','{{.Image}}',containerId),
    archive:{bytes:archiveBytes.length,sha256:sha(archiveBytes)},backupMs,restoreMs,totalMs:Math.round(performance.now()-began),
    checks:['Exact account and outbox table restoration after source deletion','Pending, posted, uncertain and interrupted sending states preserved',
      'Posted receipt replay remains idempotent','Hourly/daily caps and counters remain binding','Collector cursor and atomic rollback survive restore',
      'Expired sending becomes uncertain and stale completion is fenced','Two workers dispatch only the restored pending event after a simulated next window'],
    realXPosts:0,realSolanaTransactions:0,limitations:['Quiesced synthetic fixture only; production backup retention, encryption and point-in-time recovery are not exercised.','Posts accepted by X after the backup boundary require external reconciliation before restoring live dispatch.']};
}finally{
  await Promise.allSettled(stores.map(store=>store.close()));
  await Promise.allSettled(pools.map(pool=>pool.end()));
  try{
    if(containerId){
      assert.equal(await docker('inspect','--format','{{index .Config.Labels "app.funded.x-recovery"}}',containerId),runId);
      await docker('rm','--force','--volumes',containerId);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
}
if(reportPath)await writeFile(reportPath,`${JSON.stringify(outcome,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({...outcome,cleanup:'Task-owned PostgreSQL container, volume and temporary archive removed.'},null,2));
