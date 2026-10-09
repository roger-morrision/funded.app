import pg from 'pg';
import { pgPoolConfig } from './db-config.mjs';
import { migrate, createLedgerRepository } from './postgres/ledger.mjs';
import { createClaimsRepository } from './postgres/claims.mjs';
import { createReceiptsRepository } from './postgres/receipts.mjs';
import { createCreatorsRepository } from './postgres/creators.mjs';
import { createAccountsRepository } from './postgres/accounts.mjs';
import { createAssetsRepository } from './postgres/assets.mjs';

const { Pool } = pg;

export function createPostgresStore(databaseUrl) {
  const pool = new Pool(pgPoolConfig(databaseUrl));
  // An idle connection can fail independently of a request. Never log connection URLs.
  pool.on('error', () => console.error(JSON.stringify({ event: 'database_idle_connection_failure' })));
  let ready;
  let rpcCharges = 0;
  let marketWrites = 0;
  const ensureReady = async () => { ready ||= migrate(pool).catch(error => { ready = undefined; throw error; }); await ready; };
  return {
    ...createLedgerRepository({ pool, ensureReady }),
    ...createClaimsRepository({ pool, ensureReady }),
    ...createReceiptsRepository({ pool, ensureReady }),
    ...createCreatorsRepository({ pool, ensureReady }),
    ...createAccountsRepository({ pool, ensureReady }),
    ...createAssetsRepository({ pool, ensureReady }),
    async health() { await ensureReady(); await pool.query({ text: 'SELECT 1', query_timeout: 3000 }); return true; },
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
      if (!Number.isSafeInteger(units) || !Number.isSafeInteger(limit) || units <= 0 || units > limit || !Number.isSafeInteger(windowStart)) return false;
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
