import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgPoolConfig } from './db-config.mjs';

const { Pool } = pg;
const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');
const buckets = ['launches', 'settlements', 'obligations', 'claims', 'referralClaims', 'payouts', 'collections', 'launchReviews', 'alerts', 'xIntake', 'referralCodes', 'referralWallets', 'referralAttributions', 'referralChallenges'];
const referralBuckets = { referralCodes: 'codes', referralWallets: 'wallets', referralAttributions: 'attributions', referralChallenges: 'challenges' };

function entriesFor(state, bucket) { return referralBuckets[bucket] ? state.referrals[referralBuckets[bucket]] : state[bucket]; }

function initialState() {
  return { version: 4, launches: {}, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {}, launchReviews: {}, alerts: {}, xIntake: {}, referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} } };
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
  next.referrals ||= { codes: {}, wallets: {}, attributions: {}, challenges: {} };
  next.referrals.codes ||= {};
  next.referrals.wallets ||= {};
  next.referrals.attributions ||= {};
  next.referrals.challenges ||= {};
  next.version = Math.max(4, Number(next.version) || 1);
  return next;
}

async function migrate(pool) {
  await pool.query(await readFile(schemaPath, 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(81730421)');
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
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function readState(client) {
  const [meta, rows] = await Promise.all([
    client.query('SELECT version, last_indexed_at FROM state_meta WHERE id = 1'),
    client.query('SELECT bucket, entity_key, payload FROM state_entities'),
  ]);
  const state = initialState();
  state.version = meta.rows[0]?.version || 4;
  if (meta.rows[0]?.last_indexed_at) state.lastIndexedAt = new Date(meta.rows[0].last_indexed_at).toISOString();
  for (const row of rows.rows) {
    const target = entriesFor(state, row.bucket);
    if (target) target[row.entity_key] = row.payload;
  }
  return state;
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

export function createPostgresStore(databaseUrl) {
  const pool = new Pool(pgPoolConfig(databaseUrl));
  let ready;
  let rpcCharges = 0;
  const ensureReady = async () => { ready ||= migrate(pool).catch(error => { ready = undefined; throw error; }); await ready; };
  return {
    async read() {
      await ensureReady();
      return readState(pool);
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
        for (const bucket of buckets) {
          const previous = before.get(bucket);
          const current = entriesFor(state, bucket);
          for (const [key, value] of Object.entries(current)) {
            const encoded = JSON.stringify(value);
            if (previous.get(key) === encoded) continue;
            await client.query('INSERT INTO state_entities (bucket, entity_key, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT (bucket, entity_key) DO UPDATE SET payload = EXCLUDED.payload', [bucket, key, encoded]);
            await project(client, bucket, key, value);
          }
          for (const key of previous.keys()) if (!Object.hasOwn(current, key)) {
            await client.query('DELETE FROM state_entities WHERE bucket = $1 AND entity_key = $2', [bucket, key]);
            await project(client, bucket, key, null);
          }
        }
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
