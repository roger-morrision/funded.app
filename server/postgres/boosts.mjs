const writable = ['boostQuotes','boostPayments','boostReceipts','adminAudit'];
async function readScope(client, { mint = '', quoteId = '', signature = '' }) {
  const state = { boostQuotes:{}, boostPayments:{}, boostReceipts:{}, adminAudit:{}, adminSettings:{}, launches:{}, listings:{} };
  const queries = [
    ["SELECT bucket,entity_key,payload FROM state_entities WHERE bucket='boostQuotes' AND entity_key=$1",[quoteId]],
    ["SELECT bucket,entity_key,payload FROM state_entities WHERE bucket='boostPayments' AND (payload->>'quoteId'=$1 OR entity_key=$2)",[quoteId,signature]],
    ["SELECT bucket,entity_key,payload FROM state_entities WHERE bucket='boostReceipts' AND (payload->>'mint'=$1 OR payload->>'quoteId'=$2 OR entity_key=$3)",[mint,quoteId,signature]],
    ["SELECT bucket,entity_key,payload FROM state_entities WHERE bucket IN ('launches','listings') AND entity_key=$1",[mint]],
    ["SELECT bucket,entity_key,payload FROM state_entities WHERE bucket='adminSettings' AND entity_key='boostPricing'",[]],
  ];
  for (const [sql,params] of queries) for (const row of (await client.query(sql,params)).rows) state[row.bucket][row.entity_key] = row.payload;
  return state;
}
export function createBoostRepository({ pool, ensureReady }) {
  return {
    async readBoostState(scope) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const state = await readScope(client,scope); await client.query('COMMIT'); return state;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async updateBoostState(scope, mutator) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Shared compatibility lock excludes legacy writers, not other scoped writes.
        await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        // Also lock missing rows: concurrent first inserts must obey the same
        // quote/signature uniqueness and per-mint stacking rules.
        const locks = [scope.mint && `mint:${scope.mint}`,scope.quoteId && `quote:${scope.quoteId}`,scope.signature && `signature:${scope.signature}`].filter(Boolean).sort();
        if (!locks.length) throw new Error('A boost mutation requires an entity scope.');
        for (const key of locks) await client.query('SELECT pg_advisory_xact_lock(81730428,hashtext($1))',[key]);
        const state = await readScope(client,scope);
        const before = Object.fromEntries(writable.map(bucket => [bucket, new Map(Object.entries(state[bucket]).map(([key,value]) => [key,JSON.stringify(value)]))]));
        const output = mutator(state);
        if (output?.then) throw new Error('Boost mutations must be synchronous.');
        for (const bucket of writable) {
          for (const [key,value] of Object.entries(state[bucket])) {
            const encoded = JSON.stringify(value);
            if (encoded !== before[bucket].get(key)) await client.query('INSERT INTO state_entities(bucket,entity_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload',[bucket,key,encoded]);
          }
          for (const key of before[bucket].keys()) if (!Object.hasOwn(state[bucket],key)) await client.query('DELETE FROM state_entities WHERE bucket=$1 AND entity_key=$2',[bucket,key]);
        }
        await client.query('COMMIT'); return output;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
  };
}
