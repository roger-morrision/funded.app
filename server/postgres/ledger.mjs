import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creatorDirectoryRecords } from '../creator-directory.mjs';
import { searchGrams } from '../creator-search.mjs';

const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'schema.sql');
const buckets = ['launches', 'listings', 'boostQuotes', 'boostReceipts', 'launchTierQuotes', 'xPublicTradeShares', 'settlements', 'obligations', 'claims', 'referralClaims', 'payouts', 'collections', 'burnReceipts', 'buybackOrders', 'communityReserveReceipts', 'launchReviews', 'alerts', 'xIntake', 'coinChats', 'shareVisits', 'referralCodes', 'referralWallets', 'referralAttributions', 'referralChallenges'];
const referralBuckets = { referralCodes: 'codes', referralWallets: 'wallets', referralAttributions: 'attributions', referralChallenges: 'challenges' };
buckets.push('creatorProfiles');

function entriesFor(state, bucket) { return referralBuckets[bucket] ? state.referrals[referralBuckets[bucket]] : state[bucket]; }

function initialState() {
  return { version: 4, launches: {}, listings: {}, boostQuotes: {}, boostReceipts: {}, launchTierQuotes: {}, xPublicTradeShares: {}, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, burnReceipts: {}, buybackOrders: {}, communityReserveReceipts: {}, launchReviews: {}, alerts: {}, xIntake: {}, coinChats: {}, shareVisits: {}, creatorProfiles: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
}

function normalizeState(state) {
  const next = { ...initialState(), ...state };
  next.launches ||= {};
  next.listings ||= {};
  next.boostQuotes ||= {};
  next.boostReceipts ||= {};
  next.launchTierQuotes ||= {};
  next.xPublicTradeShares ||= {};
  next.settlements ||= {};
  next.obligations ||= {};
  next.claims ||= {};
  next.referralClaims ||= {};
  next.payouts ||= {};
  next.collections ||= {};
  next.burnReceipts ||= {};
  next.buybackOrders ||= {};
  next.communityReserveReceipts ||= {};
  next.launchReviews ||= {};
  next.alerts ||= {};
  next.xIntake ||= {};
  next.coinChats ||= {};
  next.shareVisits ||= {};
  next.creatorProfiles ||= {};
  next.referrals ||= { codes: {}, wallets: {}, attributions: {}, challenges: {} };
  next.referrals.codes ||= {};
  next.referrals.wallets ||= {};
  next.referrals.attributions ||= {};
  next.referrals.challenges ||= {};
  next.version = Math.max(4, Number(next.version) || 1);
  return next;
}


export async function migrate(pool) {
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

export async function project(client, bucket, key, item) {
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

export async function projectCreatorDirectory(client, state, changedIds = null) {
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

// Legacy ledger writes keep their exclusive lock and projection updates together.
export function createLedgerRepository({ pool, ensureReady }) {
  return {
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
  };
}
