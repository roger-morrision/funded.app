// Disposable recovery exercise. Never connects to DATABASE_URL or an existing container.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { createAutomaticRewardStore } from '../server/automatic-reward-store.mjs';
import { createAutomaticRewardWorker } from '../server/automatic-rewards.mjs';
import { createTokenChatSessions } from '../server/token-chat-session.mjs';
import { receiptHistoryFixture } from './fixtures/receipt-history-data.mjs';

const args = process.argv.slice(2);
assert.ok(args[0] === '--run' && (args.length === 1 || (args.length === 3 && args[1] === '--report')),
  'Use --run [--report path]. This creates and removes only a new disposable local Docker PostgreSQL container. Existing database/container targets are not accepted.');
const reportPath = args[1] === '--report' ? resolve(args[2]) : null;
const execute = promisify(execFile);
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key];
const docker = async (...command) => (await execute('docker', ['--host=unix:///var/run/docker.sock', ...command],
  { env:dockerEnv, timeout:180_000, maxBuffer:4 * 1024 * 1024 })).stdout.trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const runId = randomUUID();
const name = `funded-restore-drill-${runId}`;
const sourceDb = 'funded_restore_source';
const restoredDb = 'funded_restore_target';
const directory = await mkdtemp(join(tmpdir(), 'funded-restore-drill-'));
let containerId = null;
const stores = [], pools = [];
const started = performance.now();
let outcome;

async function tableSnapshot(pool) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  const snapshot = {};
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/, 'Only app public tables may be inspected.');
    snapshot[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(row => row.row);
  }
  return snapshot;
}

try {
  await docker('info', '--format', '{{.ServerVersion}}');
  const password = randomBytes(24).toString('hex');
  const envPath = join(directory, 'postgres.env');
  await writeFile(envPath, `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=${sourceDb}\n`, { mode:0o600 });
  containerId = await docker('run', '--detach', '--name', name, '--label', `app.funded.restore-drill=${runId}`,
    '--env-file', envPath, '--publish', '127.0.0.1::5432', 'postgres:16-alpine');
  assert.match(containerId, /^[a-f0-9]{64}$/);
  const address = await docker('port', containerId, '5432/tcp');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const port = Number(address.split(':')[1]);
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    // The image briefly runs a Unix-socket-only initialization server; wait for
    // the final TCP listener so startup shutdown cannot race the first migration.
    try { await docker('exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', sourceDb); ready = true; break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready.');
  const urlFor = database => {
    assert.ok([sourceDb, restoredDb].includes(database), 'Only fresh drill databases are allowed.');
    return `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
  };
  const poolFor = database => {
    const pool = new pg.Pool({ connectionString:urlFor(database), connectionTimeoutMillis:5000 });
    pools.push(pool); return pool;
  };
  const storeFor = database => { const store = createPostgresStore(urlFor(database)); stores.push(store); return store; };
  const source = storeFor(sourceDb), sourcePool = poolFor(sourceDb);
  const fixture = receiptHistoryFixture(3);
  const firstCollection = Object.keys(fixture.state.collections)[0];
  await source.update(state => {
    Object.assign(state, fixture.state);
    state.settlements.fixture = { claimSignature:'fixture', status:'settled', asset:'SOL', grossCreatorFees:0.001 };
    state.referralClaims.fixture = { id:'fixture', status:'wallet-verified', level:1, amount:0.0001, asset:'SOL', recipientWallet:'fixture-wallet' };
  });
  await source.updateCoinChat(fixture.mint, messages => { messages.push({ id:'before-backup', text:'Synthetic recovery fixture', status:'visible' }); });
  const image = Buffer.from('Synthetic image bytes for backup integrity; not a render fixture.');
  const metadata = { mint:fixture.mint, creatorWallet:fixture.state.launches[fixture.mint].creatorWallet,
    name:'Recovery fixture', symbol:'RESTORE', description:'Synthetic backup drill', imageSha256:digest(image) };
  await source.writeMetadata(metadata, image, 'image/png');
  const proofKey = digest('restore-fixture-proof');
  await source.writeReceiptProofs([{ key:proofKey, cluster:'devnet', commitment:'finalized', proof:{ signature:'synthetic-only', slot:123 } }]);
  await source.acquireReceiptBackfill('devnet', 'stopped-fixture-worker', 60_000);
  await source.checkpointReceiptBackfill('devnet', 'stopped-fixture-worker', { bucket:'payouts', after:'fixture', checked:3 }, 60_000);
  await source.releaseReceiptBackfill('devnet', 'stopped-fixture-worker');
  const expires = Date.now() + 3_600_000;
  for (const kind of ['session', 'oauth', 'referral-challenge', 'referral-session', 'chat-challenge:devnet']) {
    await source.authPut(kind, digest(kind), { fixture:true, kind }, expires);
  }
  const chatToken = randomBytes(32).toString('base64url');
  const origin = 'https://restore-fixture.invalid';
  await source.authPut('chat-session:devnet', digest(chatToken), { address:'synthetic-wallet', origin, expiresAtMs:expires }, expires);

  // The separate reward ledger is part of the quiesced backup bundle.
  const rewardPath = join(directory, 'source-rewards.json');
  const rewards = createAutomaticRewardStore(rewardPath);
  await rewards.transaction(state => {
    state.obligations.paid = { id:'paid', status:'paid', amount:'10000000' };
    state.obligations.pending = { id:'pending', status:'queued', amount:'10000000' };
    state.batches.paid = { id:'paid', status:'paid', recipient:'fixture-wallet', asset:'SOL', amount:'10000000', obligationIds:['paid'], signature:'synthetic-paid' };
    state.batches.pending = { id:'pending', status:'submitted', recipient:'fixture-wallet', asset:'SOL', amount:'10000000', obligationIds:['pending'] };
    state.fundingRequests.fixture = { id:'fixture', sourceSignature:firstCollection, status:'funded', amount:'1000000' };
  });
  const expected = await tableSnapshot(sourcePool);
  const expectedLedger = await source.read();
  console.log('Recovery drill: synthetic ledger, metadata, auth and reward sidecar seeded; all fixture writers stopped.');
  const backupStart = performance.now();
  await docker('exec', containerId, 'pg_dump', '-U', 'postgres', '--format=custom', '--no-owner', '--no-acl', '--file=/tmp/funded-recovery.dump', sourceDb);
  const archive = join(directory, 'database.dump');
  await docker('cp', `${containerId}:/tmp/funded-recovery.dump`, archive);
  await chmod(archive, 0o600);
  const rewardBackup = join(directory, 'automatic-rewards.backup.json');
  await copyFile(rewardPath, rewardBackup);
  await chmod(rewardBackup, 0o600);
  const archiveBytes = await readFile(archive), rewardBytes = await readFile(rewardBackup);
  await docker('exec', containerId, 'pg_restore', '--list', '/tmp/funded-recovery.dump');
  const backupMs = Math.round(performance.now() - backupStart);
  await source.close(); stores.splice(stores.indexOf(source), 1);
  await sourcePool.end(); pools.splice(pools.indexOf(sourcePool), 1);
  // Remove the source to ensure verification cannot accidentally read original rows/files.
  await docker('exec', containerId, 'dropdb', '-U', 'postgres', sourceDb);
  await rm(rewardPath);
  const restoreStart = performance.now();
  await docker('exec', containerId, 'createdb', '-U', 'postgres', '--template=template0', restoredDb);
  await docker('exec', containerId, 'pg_restore', '-U', 'postgres', '--dbname', restoredDb,
    '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '/tmp/funded-recovery.dump');
  const restoredRewardPath = join(directory, 'restored-rewards.json');
  await copyFile(rewardBackup, restoredRewardPath);
  await chmod(restoredRewardPath, 0o600);
  const restoredPool = poolFor(restoredDb);
  assert.deepEqual(await tableSnapshot(restoredPool), expected, 'Every restored public-table row must match the quiesced snapshot.');
  assert.equal(digest(await readFile(restoredRewardPath)), digest(rewardBytes));
  const restoreMs = Math.round(performance.now() - restoreStart);
  const restored = storeFor(restoredDb), replica = storeFor(restoredDb);
  await Promise.all([restored.health(), replica.health()]);
  assert.deepEqual(await restored.read(), expectedLedger, 'Startup migrations must preserve restored ledger contents.');
  assert.deepEqual(await restored.readMetadata(fixture.mint), metadata);
  const restoredImage = await restored.readMetadataImage(fixture.mint);
  assert.equal(restoredImage.mime, 'image/png');
  assert.equal(digest(restoredImage.bytes), metadata.imageSha256);
  assert.equal((await restored.readReceiptProofs([proofKey])).length, 1);
  assert.equal((await restored.readCreatorReceiptPage(fixture.id, 'devnet')).checkedPayouts, 3);
  assert.equal(await createTokenChatSessions(restored).address(chatToken, origin), 'synthetic-wallet');
  const consumed = await Promise.all([restored, replica].map(store => store.authTake('chat-challenge:devnet', digest('chat-challenge:devnet'))));
  assert.equal(consumed.filter(Boolean).length, 1, 'Restored challenges remain one-use across replicas.');
  // Actual recovery must revoke restored sessions before sign-in is reopened.
  await restoredPool.query('DELETE FROM auth_records');
  assert.equal(await createTokenChatSessions(replica).address(chatToken, origin), null);
  assert.equal((await restoredPool.query('SELECT count(*)::int AS count FROM auth_records')).rows[0].count, 0);
  await assert.rejects(restored.updateClaimState('history-000', state => { state.claims['history-000'].status = 'wallet-verified'; }), /Paid claims are immutable/);
  await Promise.all(Array.from({ length:12 }, (_, index) => (index % 2 ? restored : replica).updateCoinChat(fixture.mint, messages => { messages.push({ id:`restored-${index}` }); })));
  await Promise.all([restored.updateCoinChat(fixture.mint, messages => { messages.push({ id:'scoped-with-legacy' }); }),
    replica.update(state => { state.alerts.recovery = { status:'verified' }; })]);
  assert.equal((await restored.readCoinChat(fixture.mint, 100)).length, 14);
  assert.equal((await replica.read()).alerts.recovery.status, 'verified');
  assert.ok(await restored.acquireReceiptBackfill('devnet', 'restored-worker', 60_000));
  assert.equal(await replica.acquireReceiptBackfill('devnet', 'competing-worker', 60_000), null);
  await restored.releaseReceiptBackfill('devnet', 'restored-worker');
  let submissions = 0;
  const mockChain = { readiness:async () => ({ constrainedPayouts:true }),
    lookup:async batch => ({ ...batch, finalized:true, balanceDeltaVerified:true, signature:'synthetic-reconciled' }),
    submit:async () => { submissions++; throw new Error('The recovery fixture must never submit a transfer.'); } };
  const rewardStore = createAutomaticRewardStore(restoredRewardPath);
  const restoredFunding = (await rewardStore.read()).fundingRequests.fixture;
  const restoredCollection = (await restored.read()).collections[restoredFunding.sourceSignature];
  assert.ok(restoredCollection, 'Restored sidecar funding must retain its original PostgreSQL collection.');
  assert.equal(restoredFunding.amount, String(restoredCollection.collectedLamports));
  const worker = createAutomaticRewardWorker({ store:rewardStore, chain:mockChain });
  await worker.tick(); await worker.sendPrepared();
  await createAutomaticRewardWorker({ store:createAutomaticRewardStore(restoredRewardPath), chain:mockChain }).tick();
  assert.equal((await rewardStore.read()).batches.pending.status, 'paid');
  assert.equal((await rewardStore.read()).obligations.pending.status, 'paid');
  assert.equal(submissions, 0);
  outcome = { result:'passed', observedAt:new Date().toISOString(), scope:'synthetic-quiesced-local-restore',
    postgresVersion:await docker('exec', containerId, 'postgres', '--version'), imageId:await docker('inspect', '--format', '{{.Image}}', containerId),
    tables:Object.fromEntries(Object.entries(expected).map(([table, rows]) => [table, rows.length])),
    archiveBytes:archiveBytes.length, archiveSha256:digest(archiveBytes), rewardSidecarSha256:digest(rewardBytes),
    backupMs, restoreAndCompareMs:restoreMs, elapsedMs:Math.round(performance.now() - started),
    metadataImageVerified:true, rewardSourceLinkVerified:true, startupMigrationsVerified:true, restoredAuthInvalidated:true,
    atomicChallengeConsumptionVerified:true, paidClaimReplayRejected:true, concurrentWritesVerified:true,
    workerLeaseExclusionVerified:true, rewardReconciliation:'mocked-finalized-proof', transactionSubmissions:submissions,
    limitations:['not a production backup', 'no live concurrent snapshot coordination', 'no PITR/WAL replay',
      'no real RPC/financial settlement verification', 'no production RPO/RTO or external object-store durability claim'] };
} finally {
  await Promise.allSettled(stores.map(store => store.close()));
  await Promise.allSettled(pools.map(pool => pool.end()));
  try {
    if (containerId) {
      const owner = await docker('inspect', '--format', '{{index .Config.Labels "app.funded.restore-drill"}}', containerId);
      assert.equal(owner, runId, 'Refusing to remove a container without the current drill ownership label.');
      await docker('rm', '--force', '--volumes', containerId);
    }
  } finally { await rm(directory, { recursive:true, force:true }); }
}
outcome.cleanedUp = true;
if (reportPath) await writeFile(reportPath, `${JSON.stringify(outcome, null, 2)}\n`, { mode:0o600 });
console.log(JSON.stringify(outcome, null, 2));
