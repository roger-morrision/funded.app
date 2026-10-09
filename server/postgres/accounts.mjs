

// Each operation uses the shared pool and readiness gate; transactions stay local.
export function createAccountsRepository({ pool, ensureReady }) {
  return {
    async readWatchlist(accountId, cluster) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM account_watchlists WHERE account_id=$1 AND cluster=$2', [accountId, cluster]);
      return result.rows[0]?.payload || { mints: [], imports: [] };
    },
    async updateWatchlist(accountId, cluster, mutator) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO account_watchlists(account_id,cluster) VALUES($1,$2) ON CONFLICT DO NOTHING', [accountId, cluster]);
        const result = await client.query('SELECT payload FROM account_watchlists WHERE account_id=$1 AND cluster=$2 FOR UPDATE', [accountId, cluster]);
        const row = mutator(result.rows[0].payload);
        await client.query('UPDATE account_watchlists SET payload=$3::jsonb WHERE account_id=$1 AND cluster=$2', [accountId, cluster, JSON.stringify(row)]);
        await client.query('COMMIT');
        return row;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
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
    async readCoinChat(mint, limit = 50) {
      await ensureReady();
      const result = await pool.query('SELECT payload FROM state_entities WHERE bucket = $1 AND entity_key = $2', ['coinChats', mint]);
      return Array.isArray(result.rows[0]?.payload) ? result.rows[0].payload.slice(-limit) : [];
    },
    async updateCoinChat(mint, mutator) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Coordinate with legacy whole-ledger writers, while unrelated chats coexist.
        await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query('SELECT pg_advisory_xact_lock(81730425, hashtext($1))', [mint]);
        const row = await client.query('SELECT payload FROM state_entities WHERE bucket=$1 AND entity_key=$2', ['coinChats', mint]);
        const messages = Array.isArray(row.rows[0]?.payload) ? row.rows[0].payload : [];
        const result = mutator(messages);
        if (result && typeof result.then === 'function') throw new Error('Chat mutations must be synchronous.');
        await client.query('INSERT INTO state_entities(bucket,entity_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload', ['coinChats', mint, JSON.stringify(messages.slice(-100))]);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async appendCoinChat(mint, message, limit = 100) {
      return this.updateCoinChat(mint, messages => { messages.push(message); messages.splice(0, Math.max(0, messages.length - limit)); return message; });
    },
  };
}
