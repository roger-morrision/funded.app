import pg from 'pg';
import { pgPoolConfig } from './db-config.mjs';

// Every token the app discovers (Explore feeds, token pages, holdings) is kept
// here so Home, Explore and token pages render instantly from the database while
// fresh market data refreshes in the background. Display-only, never used for
// balances, payments or trading decisions.
export function createTokenCache({ databaseUrl = process.env.DATABASE_URL, cluster, now = Date.now, injectedPool = null } = {}) {
  const pool = injectedPool || (databaseUrl ? new pg.Pool({ ...pgPoolConfig(databaseUrl), max: 3, statement_timeout: 5000 }) : null);
  const memory = new Map();
  let ready = null;
  async function init() {
    if (!pool) return false;
    ready ||= pool.query(`CREATE TABLE IF NOT EXISTS discovered_tokens (
        cluster TEXT NOT NULL, mint TEXT NOT NULL, data JSONB NOT NULL,
        market_cap DOUBLE PRECISION, volume_24h DOUBLE PRECISION, last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (cluster, mint));
      CREATE INDEX IF NOT EXISTS discovered_tokens_mc ON discovered_tokens (cluster, market_cap DESC NULLS LAST);
      CREATE INDEX IF NOT EXISTS discovered_tokens_vol ON discovered_tokens (cluster, volume_24h DESC NULLS LAST);
      CREATE INDEX IF NOT EXISTS discovered_tokens_seen ON discovered_tokens (cluster, last_seen DESC);`).then(() => true).catch(() => { ready = null; return false; });
    return ready;
  }
  const clean = row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  async function upsert(rows) {
    const list = rows.filter(row => row && typeof row.mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)).slice(0, 200);
    if (!list.length) return 0;
    for (const row of list) memory.set(row.mint, { ...(memory.get(row.mint) || {}), ...clean(row), cachedAt: new Date(now()).toISOString() });
    if (memory.size > 5000) memory.delete(memory.keys().next().value);
    if (!await init()) return list.length;
    const values = [], params = [];
    list.forEach((row, index) => {
      const base = index * 5;
      values.push(`($${base + 1},$${base + 2},$${base + 3}::jsonb,$${base + 4},$${base + 5})`);
      params.push(cluster, row.mint, JSON.stringify(clean(row)), Number.isFinite(row.marketCapUsd) ? row.marketCapUsd : null, Number.isFinite(row.volume24hUsd) ? row.volume24hUsd : null);
    });
    await pool.query(`INSERT INTO discovered_tokens (cluster, mint, data, market_cap, volume_24h) VALUES ${values.join(',')}
      ON CONFLICT (cluster, mint) DO UPDATE SET data = discovered_tokens.data || EXCLUDED.data,
        market_cap = COALESCE(EXCLUDED.market_cap, discovered_tokens.market_cap), volume_24h = COALESCE(EXCLUDED.volume_24h, discovered_tokens.volume_24h),
        last_seen = now(), updated_at = now()`, params).catch(() => null);
    return list.length;
  }
  async function read(mints) {
    const wanted = [...new Set(mints)].slice(0, 200), result = new Map();
    if (await init()) {
      const { rows } = await pool.query('SELECT mint, data, updated_at FROM discovered_tokens WHERE cluster=$1 AND mint = ANY($2)', [cluster, wanted]).catch(() => ({ rows: [] }));
      for (const row of rows) result.set(row.mint, { ...row.data, cachedAt: row.updated_at.toISOString() });
    }
    for (const mint of wanted) if (!result.has(mint) && memory.has(mint)) result.set(mint, memory.get(mint));
    return result;
  }
  async function list({ sort = 'volume', limit = 40, offset = 0 } = {}) {
    const order = sort === 'market_cap' ? 'market_cap DESC NULLS LAST' : sort === 'newest' ? 'last_seen DESC' : 'volume_24h DESC NULLS LAST';
    if (await init()) {
      const { rows } = await pool.query(`SELECT data, updated_at FROM discovered_tokens WHERE cluster=$1 AND updated_at > now() - interval '7 days'
        ORDER BY ${order} LIMIT $2 OFFSET $3`, [cluster, Math.min(limit, 100), Math.max(offset, 0)]).catch(() => ({ rows: [] }));
      if (rows.length) return rows.map(row => ({ ...row.data, cachedAt: row.updated_at.toISOString() }));
    }
    const key = sort === 'market_cap' ? 'marketCapUsd' : 'volume24hUsd';
    return [...memory.values()].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(offset, offset + limit);
  }
  return { upsert, read, list, close: () => pool?.end?.() };
}
