export function createDiscoveryRepository({ pool, ensureReady }) {
  return {
    async readDiscoveryRegistry(cluster, { limit = 40, offset = 0, sort = 'market_cap' } = {}) {
      await ensureReady();
      limit = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 40));
      offset = Math.max(0, Math.trunc(Number(offset)) || 0);
      const order = sort === 'created_timestamp' ? 'r.created_at' : sort === 'market_cap' ? 't.market_cap' : 't.volume_24h';
      // Rank only registered mints, then retrieve at most three entries per mint.
      // The token cache is display-only; it never supplies transaction quotes.
      const { rows } = await pool.query(`WITH registry AS (
        SELECT mint, max(created_at) AS created_at FROM discovery_entries WHERE cluster=$1 GROUP BY mint
      ), page AS (
        SELECT r.mint, row_number() OVER(ORDER BY ${order} DESC NULLS LAST,r.mint) AS position
        FROM registry r LEFT JOIN discovered_tokens t ON t.cluster=$1 AND t.mint=r.mint
        ORDER BY ${order} DESC NULLS LAST,r.mint LIMIT $2 OFFSET $3
      ) SELECT p.position,d.bucket,d.entity_key,d.payload,(SELECT count(*) FROM registry)::integer AS total
        FROM page p JOIN discovery_entries d ON d.cluster=$1 AND d.mint=p.mint ORDER BY p.position,d.bucket`, [cluster,limit,offset]);
      const state = { launches:{}, listings:{}, pairLaunches:{} };
      for (const row of rows) state[row.bucket][row.entity_key] = row.payload;
      let total = rows[0]?.total;
      if (total == null) total = (await pool.query('SELECT count(DISTINCT mint)::integer AS total FROM discovery_entries WHERE cluster=$1',[cluster])).rows[0]?.total || 0;
      return { state, total, mints: [...new Set(rows.map(row => row.payload.mint))] };
    },
  };
}
