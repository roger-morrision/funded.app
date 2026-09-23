import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgPoolConfig } from './db-config.mjs';
import { metadataStatement } from '../devnet-metadata.js';
import { creatorDirectoryRecords } from './creator-directory.mjs';
import { RECEIPT_WINDOW } from './receipt-candidates.mjs';
import { creatorWriteState, mutateCreatorState } from './creator-state.mjs';
import { encodeReceiptCursor } from './receipt-history.mjs';
import { searchGrams } from './creator-search.mjs';
import { backfillPosition } from './receipt-backfill.mjs';
import { validClaimId,mutateClaimState } from './claim-state.mjs';
import {mutateReferralClaimState} from './referral-claim-state.mjs';
import { followingWindow,followingUpdatesPage } from './following-updates.mjs';
import { receiptWorkerOutcome } from './receipt-worker-status.mjs';
import { receiptRetentionOptions,receiptRetentionResult } from './receipt-retention.mjs';

const { Pool } = pg;
const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');
const buckets = ['launches', 'settlements', 'obligations', 'claims', 'referralClaims', 'payouts', 'collections', 'launchReviews', 'alerts', 'xIntake', 'coinChats', 'referralCodes', 'referralWallets', 'referralAttributions', 'referralChallenges'];
const referralBuckets = { referralCodes: 'codes', referralWallets: 'wallets', referralAttributions: 'attributions', referralChallenges: 'challenges' };
buckets.push('creatorProfiles');

function entriesFor(state, bucket) { return referralBuckets[bucket] ? state.referrals[referralBuckets[bucket]] : state[bucket]; }

function initialState() {
  return { version: 4, launches: {}, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, coinChats: {}, creatorProfiles: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
}

function normalizeState(state) {
  const next = { ...initialState(), ...state };
  next.launches ||= {};
  next.settlements ||= {};
  next.obligations ||= {};
  next.claims ||= {};
  next.referralClaims ||= {};
  next.payouts ||= {};
  next.collections ||= {};
  next.launchReviews ||= {};
  next.alerts ||= {};
  next.xIntake ||= {};
  next.coinChats ||= {};
  next.creatorProfiles ||= {};
  next.referrals ||= { codes: {}, wallets: {}, attributions: {}, challenges: {} };
  next.referrals.codes ||= {};
  next.referrals.wallets ||= {};
  next.referrals.attributions ||= {};
  next.referrals.challenges ||= {};
  next.version = Math.max(4, Number(next.version) || 1);
  return next;
}

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(81730421)');
    await client.query(await readFile(schemaPath, 'utf8'));
    const initialized = await client.query('SELECT id FROM state_meta WHERE id = 1');
    if (!initialized.rowCount) {
      const legacy = await client.query('SELECT payload FROM app_state WHERE id = 1');
      const state = normalizeState(legacy.rows[0]?.payload || initialState());
      for (const bucket of buckets) for (const [key, value] of Object.entries(entriesFor(state, bucket))) {
        await client.query('INSERT INTO state_entities (bucket, entity_key, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING', [bucket, key, JSON.stringify(value)]);
        if (['launches', 'collections', 'settlements', 'referralClaims'].includes(bucket)) await project(client, bucket, key, value);
      }
      await client.query('INSERT INTO state_meta (id, version, last_indexed_at) VALUES (1, $1, $2)', [state.version, state.lastIndexedAt || null]);
    }
    const directoryVersion = await client.query("SELECT version FROM read_model_versions WHERE name = 'creator-directory'");
    if (!directoryVersion.rowCount || directoryVersion.rows[0].version < 2) {
      await projectCreatorDirectory(client, await readState(client));
      await client.query("INSERT INTO read_model_versions (name, version) VALUES ('creator-directory', 2) ON CONFLICT(name) DO UPDATE SET version=2");
    }
    const receiptCountVersion=await client.query("SELECT version FROM read_model_versions WHERE name='receipt-counts'");
    if(!receiptCountVersion.rowCount) {
      await client.query('DELETE FROM receipt_counts');
      await client.query(`INSERT INTO receipt_counts(bucket,cluster,record_count)
        SELECT bucket,receipt_count_cluster(bucket,payload),count(*) FROM state_entities
        WHERE receipt_count_cluster(bucket,payload) IS NOT NULL GROUP BY bucket,receipt_count_cluster(bucket,payload)`);
      await client.query("INSERT INTO read_model_versions(name,version) VALUES('receipt-counts',1)");
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function readState(client) {
  const meta = await client.query('SELECT version, last_indexed_at FROM state_meta WHERE id = 1');
  const rows = await client.query('SELECT bucket, entity_key, payload FROM state_entities');
  const state = initialState();
  state.version = meta.rows[0]?.version || 4;
  if (meta.rows[0]?.last_indexed_at) state.lastIndexedAt = new Date(meta.rows[0].last_indexed_at).toISOString();
  for (const row of rows.rows) {
    const target = entriesFor(state, row.bucket);
    if (target) target[row.entity_key] = row.payload;
  }
  return state;
}

async function readClaimStateFor(client,id) {
  const state={claims:{},obligations:{},collections:{},launches:{},payouts:{}};
  const claim=(await client.query("SELECT payload FROM state_entities WHERE bucket='claims' AND entity_key=$1",[id])).rows[0]?.payload;
  if(claim)state.claims[id]=claim;
  const obligationId=claim?.obligationId||id;
  const obligation=(await client.query("SELECT payload FROM state_entities WHERE bucket='obligations' AND entity_key=$1",[obligationId])).rows[0]?.payload;
  if(obligation){
    state.obligations[obligationId]=obligation;
    const collection=(await client.query("SELECT payload FROM state_entities WHERE bucket='collections' AND entity_key=$1",[obligation.claimSignature])).rows[0]?.payload;
    if(collection)state.collections[obligation.claimSignature]=collection;
    const launch=(await client.query('SELECT payload FROM launches WHERE mint=$1',[obligation.mint])).rows[0]?.payload;
    if(launch)state.launches[obligation.mint]=launch;
  }
  const payouts=await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='payouts' AND payload->>'claimId'=$1",[id]);
  state.payouts=Object.fromEntries(payouts.rows.map(row=>[row.entity_key,row.payload]));return state;
}

async function readReferralClaimStateFor(client,id) {
  const claims=await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='referralClaims' AND entity_key=$1",[id]);
  const payouts=await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='payouts' AND (payload->>'claimId'=$1 OR entity_key=$2)",[id,`referral:${id}`]);
  return {referralClaims:Object.fromEntries(claims.rows.map(row=>[row.entity_key,row.payload])),payouts:Object.fromEntries(payouts.rows.map(row=>[row.entity_key,row.payload]))};
}

async function project(client, bucket, key, item) {
  const tables = { launches: ['launches', 'mint'], collections: ['collections', 'id'], settlements: ['settlements', 'claim_signature'], referralClaims: ['referral_claims', 'id'] };
  if (!tables[bucket]) return;
  if (item == null) {
    const [table, column] = tables[bucket];
    await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [key]);
    return;
  }
  if (bucket === 'launches') {
    await client.query('INSERT INTO launches (mint, payload, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (mint) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()', [key, JSON.stringify(item)]);
  } else if (bucket === 'collections') {
    await client.query('INSERT INTO collections (id, signature, mint, status, collected_lamports, payload, recorded_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW())) ON CONFLICT (id) DO UPDATE SET signature = EXCLUDED.signature, mint = EXCLUDED.mint, payload = EXCLUDED.payload, status = EXCLUDED.status, collected_lamports = EXCLUDED.collected_lamports', [key, item.signature || null, item.mint || null, item.status || null, item.collectedLamports ?? null, JSON.stringify(item), item.recordedAt || null]);
  } else if (bucket === 'settlements') {
    await client.query('INSERT INTO settlements (claim_signature, status, asset, gross_creator_fees, payload, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, NOW()) ON CONFLICT (claim_signature) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status, gross_creator_fees = EXCLUDED.gross_creator_fees, updated_at = NOW()', [key, item.status || null, item.asset || null, item.grossCreatorFees ?? null, JSON.stringify(item)]);
  } else if (bucket === 'referralClaims') {
    await client.query('INSERT INTO referral_claims (id, status, level, amount, asset, payload, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, status = EXCLUDED.status, amount = EXCLUDED.amount, updated_at = NOW()', [key, item.status || null, item.level ?? null, item.amount ?? null, item.asset || null, JSON.stringify(item)]);
  }
}

async function projectCreatorDirectory(client, state, changedIds = null) {
  for (const cluster of ['devnet', 'mainnet-beta', 'testnet']) {
    if (changedIds) await client.query('DELETE FROM creator_directory WHERE cluster = $1 AND creator_id = ANY($2::text[])', [cluster, [...changedIds]]);
    else await client.query('DELETE FROM creator_directory WHERE cluster = $1', [cluster]);
    for (const row of creatorDirectoryRecords(state, cluster)) {
      if (changedIds && !changedIds.has(row.id)) continue;
      const searchText=`${row.handle} ${row.name}`.toLowerCase();
      await client.query('INSERT INTO creator_directory (cluster, creator_id, payload, search_text, search_grams) VALUES ($1, $2, $3::jsonb, $4, $5::text[])',
        [cluster, row.id, JSON.stringify(row), searchText, searchGrams(searchText,true)]);
    }
  }
}

export function createPostgresStore(databaseUrl) {
  const pool = new Pool(pgPoolConfig(databaseUrl));
  let ready;
  let rpcCharges = 0;
  let marketWrites = 0;
  const ensureReady = async () => { ready ||= migrate(pool).catch(error => { ready = undefined; throw error; }); await ready; };
  return {
    async readFollowingUpdates(cluster,ids,after='') {
      const {selected}=followingWindow(ids,after);await ensureReady();
      // A single statement snapshot reads <=20 directory/profile pairs, never financial rows.
      const result=await pool.query(`SELECT d.payload AS creator,p.payload AS profile FROM creator_directory d
        LEFT JOIN state_entities p ON p.bucket='creatorProfiles' AND p.entity_key=d.creator_id
        WHERE d.cluster=$1 AND d.creator_id=ANY($2::text[]) ORDER BY d.creator_id`,[cluster,selected]);
      return followingUpdatesPage(result.rows.map(row=>row.creator),Object.fromEntries(result.rows.filter(row=>row.profile).map(row=>[row.creator.id,row.profile])),ids,after);
    },
    async readClaimState(id) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await readClaimStateFor(client,id);await client.query('COMMIT');return state;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readReferralClaimState(id) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await readReferralClaimStateFor(client,id);await client.query('COMMIT');return state;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async updateReferralClaimState(id,mutator) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try {
        await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query('SELECT pg_advisory_xact_lock(81730424,hashtext($1))',[id]);
        const state=await readReferralClaimStateFor(client,id),output=await mutateReferralClaimState(state,id,mutator);
        for(const [bucket,key] of [['referralClaims',id],['payouts',`referral:${id}`]])if(state[bucket][key]){
          await client.query('INSERT INTO state_entities(bucket,entity_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload',[bucket,key,JSON.stringify(state[bucket][key])]);
          await project(client,bucket,key,state[bucket][key]);
        }
        await client.query('COMMIT');return output;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async updateClaimState(id,mutator) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try {
        await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query('SELECT pg_advisory_xact_lock(81730423,hashtext($1))',[id]);
        const state=await readClaimStateFor(client,id),output=await mutateClaimState(state,id,mutator);
        for(const [bucket,key] of [['claims',id],['payouts',`x:${id}`]])if(state[bucket][key])await client.query('INSERT INTO state_entities(bucket,entity_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload',[bucket,key,JSON.stringify(state[bucket][key])]);
        await client.query('COMMIT');return output;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readReceiptBackfillPage(cluster,position) {
      await ensureReady();
      const {bucket,after}=backfillPosition(position),status=bucket==='collections'?'collected':'paid';
      const result=await pool.query(`SELECT entity_key,payload FROM state_entities WHERE bucket=$1 AND payload->>'cluster'=$2
        AND payload->>'status'=$3 AND jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>''
        AND entity_key COLLATE "C">$4 COLLATE "C" ORDER BY entity_key COLLATE "C" LIMIT $5`,[bucket,cluster,status,after,RECEIPT_WINDOW+1]);
      const selected=result.rows.slice(0,RECEIPT_WINDOW);
      return {state:{[bucket]:Object.fromEntries(selected.map(row=>[row.entity_key,row.payload]))},after:selected.at(-1)?.entity_key||after,hasMore:result.rows.length>RECEIPT_WINDOW,count:selected.length};
    },
    async acquireReceiptBackfill(cluster,owner,leaseMs) {
      await ensureReady();
      const result=await pool.query(`INSERT INTO receipt_backfill(cluster,owner,lease_until,progress) VALUES($1,$2,NOW()+$3*INTERVAL '1 millisecond','{}')
        ON CONFLICT(cluster) DO UPDATE SET owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until
        WHERE receipt_backfill.lease_until IS NULL OR receipt_backfill.lease_until<=NOW() RETURNING progress`,[cluster,owner,leaseMs]);
      return result.rows[0]?.progress??null;
    },
    async checkpointReceiptBackfill(cluster,owner,progress,leaseMs) {
      await ensureReady();
      const result=await pool.query(`UPDATE receipt_backfill SET progress=$3::jsonb,lease_until=NOW()+$4*INTERVAL '1 millisecond'
        WHERE cluster=$1 AND owner=$2 AND lease_until>NOW()`,[cluster,owner,JSON.stringify(progress),leaseMs]);return result.rowCount===1;
    },
    async releaseReceiptBackfill(cluster,owner) {await ensureReady();await pool.query('UPDATE receipt_backfill SET owner=NULL,lease_until=NULL WHERE cluster=$1 AND owner=$2',[cluster,owner]);},
    async readReceiptBackfillStatus(cluster) {
      await ensureReady();const row=(await pool.query('SELECT owner,lease_until,progress,last_run FROM receipt_backfill WHERE cluster=$1',[cluster])).rows[0];
      return row?{owner:row.owner,expiresAt:row.lease_until?new Date(row.lease_until).getTime():0,progress:row.progress,lastRun:row.last_run}:null;
    },
    async recordReceiptBackfillOutcome(cluster,owner,outcome) {
      const clean=receiptWorkerOutcome(outcome);await ensureReady();
      return (await pool.query('UPDATE receipt_backfill SET last_run=$3::jsonb WHERE cluster=$1 AND owner=$2 AND lease_until>NOW()',[cluster,owner,JSON.stringify(clean)])).rowCount===1;
    },
    async readReceiptProofs(keys) {
      await ensureReady();
      if (keys.length>24) throw new Error('Receipt proof read exceeds page limit.');
      const result=await pool.query('SELECT payload FROM receipt_proofs WHERE fingerprint=ANY($1::text[])',[keys]);
      return result.rows.map(row=>row.payload);
    },
    async pruneReceiptProofs(input) {
      const options=receiptRetentionOptions(input);await ensureReady();
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const rows=await client.query(`SELECT fingerprint FROM receipt_proofs WHERE verified_at<$1
          ORDER BY verified_at,fingerprint LIMIT $2 ${options.apply?'FOR UPDATE SKIP LOCKED':''}`,[options.before,options.limit+1]);
        const keys=rows.rows.slice(0,options.limit).map(row=>row.fingerprint);
        let removed=0;
        if(options.apply&&keys.length)removed=(await client.query('DELETE FROM receipt_proofs WHERE fingerprint=ANY($1::text[]) AND verified_at<$2',[keys,options.before])).rowCount;
        await client.query('COMMIT');return receiptRetentionResult(options,keys.length,rows.rowCount>options.limit,removed);
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async writeReceiptProofs(entries) {
      await ensureReady();
      if (entries.length>24) throw new Error('Receipt proof write exceeds page limit.');
      if (!entries.length) return;
      await pool.query(`INSERT INTO receipt_proofs(fingerprint,payload)
        SELECT value->>'key',value FROM jsonb_array_elements($1::jsonb)
        ON CONFLICT(fingerprint) DO UPDATE SET payload=EXCLUDED.payload,verified_at=NOW()`,[JSON.stringify(entries)]);
    },
    async readCreatorReceiptPage(id, cluster, after = '') {
      await ensureReady();
      const client=await pool.connect();
      const state={creatorProfiles:{},launches:{},obligations:{},claims:{},collections:{},payouts:{}};
      const keyed=rows=>Object.fromEntries(rows.map(row=>[row.entity_key,row.payload]));
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const rows=(await client.query(`SELECT p.entity_key,p.payload FROM state_entities p
          JOIN state_entities o ON o.bucket='obligations' AND o.entity_key=p.payload->>'obligationId'
          WHERE p.bucket='payouts' AND p.payload->>'cluster'=$2 AND p.payload->>'status'='paid'
            AND jsonb_typeof(p.payload->'signature')='string' AND p.payload->>'signature'<>''
            AND o.payload->>'xUserId'=$1 AND p.entity_key COLLATE "C">$3 COLLATE "C"
          ORDER BY p.entity_key COLLATE "C" LIMIT $4`,[id,cluster,after,RECEIPT_WINDOW+1])).rows;
        const selected=rows.slice(0,RECEIPT_WINDOW);state.payouts=keyed(selected);
        const payouts=selected.map(row=>row.payload);
        state.creatorProfiles=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1",[id])).rows);
        state.obligations=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='obligations' AND entity_key=ANY($1::text[]) AND payload->>'xUserId'=$2",[payouts.map(row=>row.obligationId),id])).rows);
        state.claims=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='claims' AND entity_key=ANY($1::text[]) AND payload->>'xUserId'=$2",[payouts.map(row=>row.claimId).filter(Boolean),id])).rows);
        const obligations=Object.values(state.obligations);
        state.collections=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='collections' AND entity_key=ANY($1::text[])",[obligations.map(row=>row.claimSignature).filter(Boolean)])).rows);
        state.launches=keyed((await client.query("SELECT mint AS entity_key,payload FROM launches WHERE mint=ANY($1::text[]) AND payload->>'xUserId'=$2 AND payload->>'cluster'=$3",[obligations.map(row=>row.mint).filter(Boolean),id,cluster])).rows);
        await client.query('COMMIT');
        return {state,nextCursor:rows.length>RECEIPT_WINDOW?encodeReceiptCursor(selected.at(-1).entity_key):null,checkedPayouts:selected.length};
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async updateCreatorProfile(id, mutator) {
      creatorWriteState({}, id); // Validate before taking any locks.
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Shared with other profile writers, exclusive against the legacy ledger
        // writer/migration. A per-identity lock also covers first-time inserts.
        await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query("SELECT pg_advisory_xact_lock(81730422, hashtext($1))", [id]);
        const profile = await client.query("SELECT payload FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1", [id]);
        const launches = await client.query("SELECT mint,payload FROM launches WHERE payload->>'xUserId'=$1", [id]);
        const scoped = creatorWriteState({ creatorProfiles: profile.rowCount ? { [id]: profile.rows[0].payload } : {},
          launches: Object.fromEntries(launches.rows.map(row => [row.mint,row.payload])) }, id);
        const output = await mutateCreatorState(scoped, id, mutator);
        if (scoped.creatorProfiles[id]) await client.query("INSERT INTO state_entities(bucket,entity_key,payload) VALUES('creatorProfiles',$1,$2::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload", [id,JSON.stringify(scoped.creatorProfiles[id])]);
        else await client.query("DELETE FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1", [id]);
        await projectCreatorDirectory(client, scoped, new Set([id]));
        await client.query('COMMIT');
        return output;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readReceiptCandidates(cluster) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = { collections: [], payouts: [], coverage: {}, scope: 'global-recent' };
        for (const [bucket, status, label] of [['collections', 'collected', 'Collections'], ['payouts', 'paid', 'Payouts']]) {
          const filter = "bucket=$1 AND payload->>'cluster'=$2 AND payload->>'status'=$3 AND jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>''";
          const args = [bucket, cluster, status];
          const count = await client.query('SELECT record_count AS count FROM receipt_counts WHERE bucket=$1 AND cluster=$2',[bucket,cluster]);
          const rows = await client.query(`SELECT payload FROM state_entities WHERE ${filter}
            ORDER BY COALESCE(NULLIF(payload->>'recordedAt',''),payload->>'paidAt','') COLLATE "C" DESC, entity_key COLLATE "C" LIMIT $4`, [...args, RECEIPT_WINDOW]);
          result[bucket] = rows.rows.map(row => row.payload);
          const recorded=Number(count.rows[0]?.count||0);
          if(!Number.isSafeInteger(recorded))throw new Error('Receipt count exceeds supported precision.');
          result.coverage[`recorded${label}`] = recorded;
          result.coverage[`checked${label}`] = result[bucket].length;
        }
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readCreatorState(id, cluster, {financial=true}={}) {
      await ensureReady();
      const client=await pool.connect();
      const state={creatorProfiles:{},launches:{},obligations:{},claims:{},collections:{},payouts:{}};
      const keyed=rows=>Object.fromEntries(rows.map(row=>[row.entity_key,row.payload]));
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        state.creatorProfiles=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1",[id])).rows);
        state.launches=keyed((await client.query("SELECT mint AS entity_key,payload FROM launches WHERE payload->>'xUserId'=$1 AND payload->>'cluster'=$2",[id,cluster])).rows);
        if(financial){
          state.obligations=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='obligations' AND payload->>'xUserId'=$1",[id])).rows);
          state.claims=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='claims' AND payload->>'xUserId'=$1",[id])).rows);
          state.collections=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='collections' AND entity_key=ANY($1::text[])",[Object.values(state.obligations).map(row=>row.claimSignature).filter(Boolean)])).rows);
          state.payouts=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='payouts' AND payload->>'obligationId'=ANY($1::text[])",[Object.keys(state.obligations)])).rows);
        }
        await client.query('COMMIT');return state;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readCreatorDirectory({ cluster, after = '', query = '', follows = [] }) {
      await ensureReady();
      // Only this small public projection is read; neither the financial ledger nor sessions are loaded.
      const values = [cluster, after];
      let filter = '';
      if (query) { values.push(searchGrams(query));filter+=` AND search_grams @> $${values.length}::text[]`;values.push(query);filter+=` AND strpos(search_text, $${values.length}) > 0`; }
      if (follows.length) { values.push(follows); filter += ` AND creator_id = ANY($${values.length}::text[])`; }
      const result = await pool.query(`SELECT payload FROM creator_directory WHERE cluster = $1 AND creator_id > $2 COLLATE "C"${filter} ORDER BY creator_id LIMIT 51`, values);
      const creators = result.rows.slice(0,50).map(row => row.payload);
      return { creators, limit: 50, nextCursor: result.rows.length > 50 ? creators.at(-1).id : null };
    },
    async authPut(kind, key, payload, expiresAt) {
      await ensureReady();
      await pool.query('DELETE FROM auth_records WHERE expires_at <= NOW()');
      await pool.query('INSERT INTO auth_records (kind, token_hash, payload, expires_at) VALUES ($1, $2, $3::jsonb, $4)', [kind, key, JSON.stringify(payload), new Date(expiresAt)]);
    },
    async authRead(kind, key) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM auth_records WHERE kind = $1 AND token_hash = $2 AND expires_at > NOW()', [kind, key]);
      return result.rows[0]?.payload || null;
    },
    async authTake(kind, key) {
      await ensureReady();
      const result = await pool.query('DELETE FROM auth_records WHERE kind = $1 AND token_hash = $2 AND expires_at > NOW() RETURNING payload', [kind, key]);
      return result.rows[0]?.payload || null;
    },
    async authDelete(kind, key) { await ensureReady(); await pool.query('DELETE FROM auth_records WHERE kind = $1 AND token_hash = $2', [kind, key]); },
    async read() {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const state = await readState(client);
        await client.query('COMMIT');
        return state;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readLaunches({ limit = null, offset = 0 } = {}) {
      await ensureReady();
      const result = limit == null
        ? await pool.query('SELECT payload FROM launches ORDER BY updated_at DESC, mint')
        : await pool.query('SELECT payload FROM launches ORDER BY updated_at DESC, mint LIMIT $1 OFFSET $2', [limit, offset]);
      return result.rows.map(row => row.payload);
    },
    async readLaunch(mint) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM launches WHERE mint = $1', [mint]);
      return result.rows[0]?.payload || null;
    },
    async writeMetadata(record, image, imageType) {
      await ensureReady();
      const inserted = await pool.query('INSERT INTO devnet_metadata (mint, creator_wallet, payload, image, image_mime) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (mint) DO NOTHING RETURNING mint', [record.mint, record.creatorWallet, JSON.stringify(record), image, imageType]);
      if (inserted.rowCount) return record;
      const existing = await pool.query('SELECT payload FROM devnet_metadata WHERE mint = $1', [record.mint]);
      if (!existing.rows[0]?.payload || metadataStatement(existing.rows[0].payload) !== metadataStatement(record)) throw new Error('Immutable Devnet metadata already exists for this mint.');
      return existing.rows[0].payload;
    },
    async readMetadata(mint) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM devnet_metadata WHERE mint = $1', [mint]);
      return result.rows[0]?.payload || null;
    },
    async readMetadataImage(mint) {
      await ensureReady();
      const result = await pool.query('SELECT image, image_mime FROM devnet_metadata WHERE mint = $1', [mint]);
      return result.rows[0]?.image ? { bytes: result.rows[0].image, mime: result.rows[0].image_mime } : null;
    },
    async readPublicBuckets() {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const meta = await client.query('SELECT version FROM state_meta WHERE id = 1');
        const launches = await client.query('SELECT mint, payload FROM launches');
        const settlements = await client.query('SELECT claim_signature, payload FROM settlements');
        const collections = await client.query('SELECT id, payload FROM collections');
        const referralClaims = await client.query('SELECT id, payload FROM referral_claims');
        await client.query('COMMIT');
        return {
          version: meta.rows[0]?.version || 4,
          launches: Object.fromEntries(launches.rows.map(row => [row.mint, row.payload])),
          settlements: Object.fromEntries(settlements.rows.map(row => [row.claim_signature, row.payload])),
          collections: Object.fromEntries(collections.rows.map(row => [row.id, row.payload])),
          referralClaims: Object.fromEntries(referralClaims.rows.map(row => [row.id, row.payload])),
        };
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readReferralClaimsForWallet(wallet) {
      await ensureReady();
      const result = await pool.query("SELECT payload FROM referral_claims WHERE payload->>'recipientWallet' = $1 ORDER BY updated_at DESC", [wallet]);
      return result.rows.map(row => row.payload);
    },
    async readCoinFeeActivity(mint, cluster) {
      await ensureReady();
      const result = await pool.query(`SELECT c.payload AS collection, s.payload AS settlement
        FROM collections c LEFT JOIN settlements s ON s.claim_signature = c.signature
        WHERE c.mint = $1 AND c.status = 'collected' AND c.payload->>'attribution' = 'mint-verified'
          AND (c.collected_lamports IS NULL OR c.collected_lamports > 0)
          AND (c.payload->>'cluster' IS NULL OR c.payload->>'cluster' = $2)
        ORDER BY c.recorded_at DESC`, [mint, cluster]);
      return {
        collections: result.rows.map(({ collection: item }) => ({ signature: item.signature, recordedAt: item.recordedAt || null, collectedLamports: item.collectedLamports ?? null })),
        claims: result.rows.flatMap(({ collection: item, settlement }) => settlement ? [{ claimSignature: item.signature, status: settlement.status || 'recorded', grossCreatorFees: settlement.grossCreatorFees ?? null, asset: settlement.asset || 'SOL', claimedAt: settlement.claimedAt || null }] : []),
      };
    },
    async readRouterFeeActivity(router, cluster) {
      await ensureReady();
      const result = await pool.query(`SELECT payload FROM collections
        WHERE payload->>'router' = $1 AND status = 'collected' AND collected_lamports > 0
          AND (payload->>'attribution' IS NULL OR payload->>'attribution' <> 'mint-verified')
          AND (payload->>'cluster' IS NULL OR payload->>'cluster' = $2)
        ORDER BY recorded_at DESC LIMIT 100`, [router, cluster]);
      return result.rows.map(({ payload: item }) => ({ signature: item.signature, recordedAt: item.recordedAt || null, collectedLamports: item.collectedLamports }));
    },
    async readCoinChat(mint, limit = 50) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM state_entities WHERE bucket = $1 AND entity_key = $2', ['coinChats', mint]);
      return Array.isArray(result.rows[0]?.payload) ? result.rows[0].payload.slice(-limit) : [];
    },
    async appendCoinChat(mint, message, limit = 100) {
      return this.update(state => { state.coinChats ||= {}; state.coinChats[mint] = [...(state.coinChats[mint] || []), message].slice(-limit); return message; });
    },
    async update(mutator) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(81730421)');
        const state = await readState(client);
        const before = new Map(buckets.map(bucket => [bucket, new Map(Object.entries(entriesFor(state, bucket)).map(([key, value]) => [key, JSON.stringify(value)]))]));
        const priorIndexedAt = state.lastIndexedAt || null;
        const priorVersion = state.version;
        const output = await mutator(state);
        const directoryChanges = new Set();
        for (const bucket of buckets) {
          const previous = before.get(bucket);
          const current = entriesFor(state, bucket);
          for (const [key, value] of Object.entries(current)) {
            const encoded = JSON.stringify(value);
            if (previous.get(key) === encoded) continue;
            if (bucket === 'creatorProfiles') directoryChanges.add(key);
            if (bucket === 'launches') {
              const prior = previous.has(key) ? JSON.parse(previous.get(key)) : null;
              if (prior?.xUserId) directoryChanges.add(String(prior.xUserId));
              if (value.xUserId) directoryChanges.add(String(value.xUserId));
            }
            await client.query('INSERT INTO state_entities (bucket, entity_key, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (bucket, entity_key) DO UPDATE SET payload = EXCLUDED.payload', [bucket, key, encoded]);
            await project(client, bucket, key, value);
          }
          for (const key of previous.keys()) if (!Object.hasOwn(current, key)) {
            if (bucket === 'creatorProfiles') directoryChanges.add(key);
            if (bucket === 'launches') {
              const prior = JSON.parse(previous.get(key));
              if (prior.xUserId) directoryChanges.add(String(prior.xUserId));
            }
            await client.query('DELETE FROM state_entities WHERE bucket = $1 AND entity_key = $2', [bucket, key]);
            await project(client, bucket, key, null);
          }
        }
        if (directoryChanges.size) await projectCreatorDirectory(client, state, directoryChanges);
        if (state.version !== priorVersion || state.lastIndexedAt !== priorIndexedAt) await client.query('UPDATE state_meta SET version = $1, last_indexed_at = $2 WHERE id = 1', [state.version, state.lastIndexedAt || null]);
        await client.query('COMMIT');
        return output;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readMarketActivity(mint, cluster) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM market_activity WHERE mint = $1 AND cluster = $2', [mint, cluster]);
      return result.rows[0]?.payload || null;
    },
    async writeMarketActivity(mint, cluster, data) {
      await ensureReady();
      await pool.query('INSERT INTO market_activity (mint, cluster, payload, observed_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (mint, cluster) DO UPDATE SET payload = EXCLUDED.payload, observed_at = EXCLUDED.observed_at', [mint, cluster, JSON.stringify(data), data.observedAt]);
      if (++marketWrites % 100 === 0) await pool.query("DELETE FROM market_activity WHERE observed_at < NOW() - INTERVAL '7 days'");
    },
    async chargeRpcRate(clientKey, units, limit, windowStart) {
      await ensureReady();
      const result = await pool.query('INSERT INTO rpc_rate_limits (client_key, window_start, units) VALUES ($1, $2, $3) ON CONFLICT (client_key, window_start) DO UPDATE SET units = rpc_rate_limits.units + EXCLUDED.units WHERE rpc_rate_limits.units + EXCLUDED.units <= $4 RETURNING units', [clientKey, windowStart, units, limit]);
      if (++rpcCharges % 1000 === 0) await pool.query('DELETE FROM rpc_rate_limits WHERE window_start < $1', [windowStart - 3_600_000]);
      return result.rowCount > 0;
    },
    async close() { await pool.end(); },
    filePath: null,
    databaseUrl,
  };
}
