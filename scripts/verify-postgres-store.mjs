import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { createPostgresStore } from '../server/postgres-store.mjs';
import { verifyAuthStore } from './verify-x-auth.mjs';
import { creatorDirectoryRecords, directoryPage } from '../server/creator-directory.mjs';
import { scopedCreatorState } from '../server/creator-state.mjs';
import { selectReceiptCandidates } from '../server/receipt-candidates.mjs';
import { verifyCreatorWrites } from './verify-creator-writes.mjs';
import { receiptHistoryFixture } from './fixtures/receipt-history-data.mjs';
import { creatorReceiptPage,decodeReceiptCursor } from '../server/receipt-history.mjs';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { verifyClaimState } from './verify-claim-state.mjs';
import { verifyBackfillStore } from './verify-receipt-backfill.mjs';
import { searchGrams } from '../server/creator-search.mjs';
import { verifyFollowingStore } from './verify-following-updates.mjs';
import { verifyReceiptRetention } from './verify-receipt-retention.mjs';
import { verifyReceiptCounts } from './verify-receipt-counts.mjs';
import {verifyReferralScopedStore} from './verify-referral-scoped-store.mjs';

async function loadLocalEnv() {
  try {
    const contents = await readFile(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      const value = match[2].replace(/^['"]|['"]$/g, '');
      if (process.env[match[1]] == null) process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

await loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
assert.equal(process.env.BACKEND_DB_TEST, '1', 'This test must be explicitly enabled.');
assert.ok(databaseUrl, 'DATABASE_URL is required. Use the isolated PostgreSQL test database on 127.0.0.1:15435/funded_test.');
const url = new URL(databaseUrl);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '15435');
assert.equal(url.pathname, '/funded_test');
const pool = new pg.Pool({ connectionString: databaseUrl });
const oldLaunch = { mint: '11111111111111111111111111111111', creatorWallet: 'legacy-creator', updatedAt: '2026-01-01T00:00:00.000Z' };
const legacy = { version: 4, launches: { [oldLaunch.mint]: oldLaunch }, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
await pool.query('DROP SCHEMA public CASCADE');
await pool.query('CREATE SCHEMA public');
await pool.query(await readFile(resolve('db/schema.sql'), 'utf8'));
// This guard restricts destructive fixture reset to the disposable test DB.
await pool.query('TRUNCATE state_meta, state_entities, market_activity, rpc_rate_limits, launches, collections, settlements, referral_claims, app_state');
await pool.query('INSERT INTO app_state (id, version, payload) VALUES (1, 4, $1::jsonb)', [JSON.stringify(legacy)]);
const store = createPostgresStore(databaseUrl);
const other = createPostgresStore(databaseUrl);
try {
  assert.deepEqual((await store.read()).launches[oldLaunch.mint], oldLaunch, 'Legacy JSON state must migrate once.');
  const before = await pool.query('SELECT updated_at FROM launches WHERE mint = $1', [oldLaunch.mint]);
  await store.update(state => { state.alerts.one = { id: 'one', status: 'active' }; });
  const after = await pool.query('SELECT updated_at FROM launches WHERE mint = $1', [oldLaunch.mint]);
  assert.equal(after.rows[0].updated_at.getTime(), before.rows[0].updated_at.getTime(), 'Unchanged launch rows must not be reprojected.');

  await Promise.all([
    store.update(state => { state.collections.claim = { id: 'claim', signature: 'claim', mint: oldLaunch.mint, status: 'collected', collectedLamports: 1_000_000_000, attribution: 'mint-verified', cluster: 'devnet' }; }),
    other.update(state => { state.referrals.codes.CODE = { wallet: 'inviter', code: 'CODE' }; }),
  ]);
  const state = await other.read();
  assert.equal(state.collections.claim.collectedLamports, 1_000_000_000);
  assert.equal(state.referrals.codes.CODE.wallet, 'inviter');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM state_entities')).rows[0].count, 4);
  await Promise.all([
    store.update(state=>{state.creatorProfiles['123']={id:'123',handle:'@fixture',listed:true,identityVerified:true,following:['456'],updates:[{text:'Local fixture',createdAt:'2026-09-20T00:00:00Z'}]};}),
    other.update(state=>{state.creatorProfiles['456']={id:'456',handle:'@other',listed:false,optedOut:true};}),
  ]);
  const profiles=(await other.read()).creatorProfiles;
  assert.deepEqual(profiles['123'].following,['456']);assert.equal(profiles['456'].optedOut,true);
  assert.deepEqual((await other.readCreatorDirectory({cluster:'devnet'})).creators.map(c=>c.id), ['123']);
  // Simulate an existing ledger receiving the projection migration for the first time.
  await pool.query('DELETE FROM creator_directory');
  await pool.query("DELETE FROM read_model_versions WHERE name = 'creator-directory'");
  const migrated=createPostgresStore(databaseUrl);
  try { assert.deepEqual((await migrated.readCreatorDirectory({cluster:'devnet'})).creators.map(c=>c.id),['123']); }
  finally { await migrated.close(); }
  await verifyAuthStore(store, other, async () => JSON.stringify((await pool.query('SELECT * FROM auth_records')).rows));
  const supportMint='5'.repeat(44), router='2'.repeat(44);
  const supportLaunch={mint:supportMint,cluster:'devnet',onchainVerified:true,policySignature:'fixture',xUserId:'700',creator:router,pumpFeeRoute:{verified:true,scope:'per-mint-v2',router},feeDistribution:{creatorDirected:{shares:{solClaimPercent:80},recipients:{xAccount:'@fan_fixture'}}}};
  await store.update(s=>{
    for(let n=200;n<270;n++)s.creatorProfiles[String(n)]={id:String(n),handle:`@fixture${n}`,name:`Creator ${n}`,listed:true,identityVerified:true};
    s.launches[supportMint]=supportLaunch;
  });
  const directoryState=await store.read();
  for(const options of [{},{after:'240'},{query:'fixture2'},{query:'%_'},{follows:['123','250','700']},{cluster:'mainnet-beta'}]) {
    const cluster=options.cluster||'devnet';
    assert.deepEqual(await other.readCreatorDirectory({cluster,...options}),directoryPage(creatorDirectoryRecords(directoryState,cluster),options));
  }
  const first=await other.readCreatorDirectory({cluster:'devnet'}),second=await other.readCreatorDirectory({cluster:'devnet',after:first.nextCursor});
  assert.equal(new Set([...first.creators,...second.creators].map(c=>c.id)).size,72);
  await store.update(s=>{s.creatorProfiles['700']={id:'700',optedOut:true};});
  assert.equal((await other.readCreatorDirectory({cluster:'devnet',follows:['700']})).creators.length,0,'Opt-out immediately removes projected discovery.');
  await store.update(s=>{delete s.creatorProfiles['700'];s.launches[supportMint].xUserId='701';});
  assert.equal((await other.readCreatorDirectory({cluster:'devnet',follows:['700']})).creators.length,0,'Changed launch removes old recipient projection.');
  assert.equal((await other.readCreatorDirectory({cluster:'devnet',follows:['701']})).creators[0].coinCount,1);
  await store.update(s=>{delete s.launches[supportMint];for(let n=200;n<270;n++)delete s.creatorProfiles[String(n)];});
  assert.equal((await other.readCreatorDirectory({cluster:'devnet',follows:['701']})).creators.length,0,'Deleting final supporting launch removes projection.');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM collections')).rows[0].count, 1);
  assert.equal((await pool.query("SELECT payload->>'mint' AS mint FROM app_state WHERE id = 1")).rows[0].mint, null, 'Legacy blob is not rewritten on updates.');

  const market = { mint: oldLaunch.mint, cluster: 'devnet', observedAt: new Date().toISOString(), coverage: 'partial' };
  await store.writeMarketActivity(oldLaunch.mint, 'devnet', market);
  assert.deepEqual(await other.readMarketActivity(oldLaunch.mint, 'devnet'), market);
  const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
  assert.equal(await store.chargeRpcRate('integration', 7, 10, windowStart), true);
  assert.equal(await other.chargeRpcRate('integration', 4, 10, windowStart), false, 'Rate budget must be shared between store instances.');
  await store.update(s=>{
    s.obligations.owned={id:'owned',xUserId:'123',claimSignature:'owned-source'};s.obligations.unrelated={id:'unrelated',xUserId:'456'};
    s.claims.owned={xUserId:'123'};s.claims.unrelated={xUserId:'456'};
    s.collections['owned-source']={id:'owned-source',signature:'owned-source',status:'collected',collectedLamports:100};
    s.payouts.owned={obligationId:'owned'};s.payouts.unrelated={obligationId:'unrelated'};
  });
  for(const id of ['123','456','999'])for(const financial of [true,false]) {
    assert.deepEqual(await other.readCreatorState(id,'devnet',{financial}),scopedCreatorState(await store.read(),id,'devnet',{financial}));
  }

  const port = 18108;
  await store.update(s => {
    for (let n=0;n<40;n++) {
      const key=`receipt-window-${String(n).padStart(2,'0')}`;
      s.collections[key]={signature:key,cluster:n===0?'mainnet-beta':'devnet',status:'collected',recordedAt:n%2?'2026-09-21T00:00:00Z':''};
      s.payouts[key]={signature:n===0?123:key,cluster:'devnet',status:n===1?'submitted':'paid',paidAt:n%2?'2026-09-21T00:00:00Z':''};
    }
  });
  for (const cluster of ['devnet','mainnet-beta','testnet']) {
    assert.deepEqual(await other.readReceiptCandidates(cluster),selectReceiptCandidates(await store.read(),cluster));
  }
  // Payload reads must stay bounded; changes and deletions are visible without a separate worker.
  await store.update(s=>{delete s.payouts['receipt-window-39'];s.collections['receipt-window-39'].status='verification-pending';});
  assert.deepEqual(await other.readReceiptCandidates('devnet'),selectReceiptCandidates(await store.read(),'devnet'));
  const api = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', FUNDED_STORE_PATH: '', FUNDED_API_TOKEN: 'postgres-test-token', DATABASE_URL: databaseUrl, DATABASE_SSL: 'false' },
    stdio: 'ignore',
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'Production API did not start on the keyed store.');
    const launchPage = await (await fetch(`${base}/api/launches?limit=1&offset=0`)).json();
    assert.equal(launchPage.length, 1);
    assert.equal(launchPage[0].mint, oldLaunch.mint);
    const activity = await (await fetch(`${base}/api/tokens/${oldLaunch.mint}/fee-activity`)).json();
    assert.equal(activity.source, 'funded.app-postgresql');
    assert.equal(activity.collections[0].collectedLamports, 1_000_000_000);
    const unauthorized = await fetch(`${base}/api/alerts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: 'viewer', mint: oldLaunch.mint }) });
    assert.equal(unauthorized.status, 401);
  } finally { api.kill(); }
  await verifyCreatorWrites(store,other,true);
  const historyFixture=receiptHistoryFixture();
  await store.update(s=>{for(const bucket of ['creatorProfiles','launches','obligations','claims','collections','payouts'])Object.assign(s[bucket],historyFixture.state[bucket]);});
  let cursor='',count=0;
  const options={store,cluster:'devnet',commitment:'finalized',officialGenesis:async()=>'fixture',connectionFactory:()=>({getGenesisHash:async()=>'fixture',getTransaction:async signature=>historyFixture.transactions.get(signature)})};
  const reader=createReceiptEvidenceReader(options);
  do {
    const page=await other.readCreatorReceiptPage('123','devnet',decodeReceiptCursor(cursor));
    assert.deepEqual(page,creatorReceiptPage(await store.read(),'123','devnet',decodeReceiptCursor(cursor)));
    const evidence=await reader(page.state);count+=evidence.verifiedPayouts.length;cursor=page.nextCursor;
  }while(cursor);
  assert.equal(count,29);
  const cached=createReceiptEvidenceReader({...options,store:other,connectionFactory:()=>{throw new Error('Persisted PostgreSQL proofs must not require repeat RPC');}});
  assert.equal((await cached((await other.readCreatorReceiptPage('123','devnet')).state)).indexedRecords,24);
  assert.equal((await other.readCreatorReceiptPage('456','devnet')).checkedPayouts,0);
  assert.equal((await other.readCreatorReceiptPage('123','mainnet-beta')).checkedPayouts,0);
  await verifyClaimState(store,other,true);
  await store.updateCreatorProfile('345',s=>{s.creatorProfiles['345']={id:'345',handle:'@unicode',name:'Tuan 🐸 100%_literal',listed:true,identityVerified:true};});
  const searchState=await store.read();
  for(const query of ['t','tu','tuan','🐸','%_','%_literal','no-match'])assert.deepEqual(await other.readCreatorDirectory({cluster:'devnet',query}),directoryPage(creatorDirectoryRecords(searchState,'devnet'),{query}));
  const gramRow=await pool.query("SELECT search_grams,search_text FROM creator_directory WHERE cluster='devnet' AND creator_id='345'");assert.deepEqual(gramRow.rows[0].search_grams,searchGrams(gramRow.rows[0].search_text,true));
  assert.equal((await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='creator_directory_search_idx'")).rows[0].indexdef.includes('USING gin'),true);
  await verifyBackfillStore(store,other);
  await verifyFollowingStore(store,other);
  await verifyReceiptCounts(pool,store,databaseUrl);
  await verifyReferralScopedStore(store,other,true);
  assert.equal((await pool.query("SELECT status FROM referral_claims WHERE id='scoped-referral-a'")).rows[0].status,'paid','Scoped writes keep the wallet discovery projection current.');
  await verifyReceiptRetention(store,async(keys,old)=>{await pool.query('UPDATE receipt_proofs SET verified_at=$2 WHERE fingerprint=ANY($1::text[])',[keys,old]);});
  const retentionKey='f'.repeat(64),retentionCutoff=new Date(Date.now()-30*86400000).toISOString();
  await store.writeReceiptProofs([{key:retentionKey,verifiedAt:new Date().toISOString(),proof:{synthetic:true}}]);
  await pool.query("UPDATE receipt_proofs SET verified_at=NOW()-INTERVAL '60 days' WHERE fingerprint=$1",[retentionKey]);
  const refreshing=await pool.connect();
  try {
    await refreshing.query('BEGIN');
    await refreshing.query('SELECT fingerprint FROM receipt_proofs WHERE fingerprint=$1 FOR UPDATE',[retentionKey]);
    assert.equal((await other.pruneReceiptProofs({before:retentionCutoff,apply:true})).removed,0,'Retention skips a concurrently refreshed proof.');
    await refreshing.query('UPDATE receipt_proofs SET verified_at=NOW() WHERE fingerprint=$1',[retentionKey]);
    await refreshing.query('COMMIT');
  }catch(error){await refreshing.query('ROLLBACK');throw error;}finally{refreshing.release();}
  assert.equal((await other.pruneReceiptProofs({before:retentionCutoff,apply:true})).removed,0);
  assert.equal((await store.readReceiptProofs([retentionKey])).length,1);
  console.log('PostgreSQL keyed-store, scoped claim/profile concurrency, indexed search, receipt counts/migration/rollback, retention and leased finalized-backfill checks passed');
} finally {
  await Promise.all([store.close(), other.close(), pool.end()]);
}
