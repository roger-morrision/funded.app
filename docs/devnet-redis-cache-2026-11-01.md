# Redis RPC cache — November 1, 2026

Redis is active behind the shared Helius gateway on Devnet. Verified at 2026-11-01T04:32:28.367Z.

The running gateway uses source `48dc3a06a5df12a9c19ec999ad75295cdaec1e17`, image `sha256:8e3ecb90708ff821bb9bb18f4a80d99856fedb03dec599018a3743f0bc2fd1b4`. Redis is pinned to `redis@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537` (Redis server v=8.10.3 sha=00000000:1 malloc=jemalloc-5.3.0 bits=64 build=defa938dbe2c41f). The app and three financial workers retained their original container IDs and release `bd621326ecb5defa15f00c4560bd5b50a351e823`; no contract or frontend deployment was needed.

| Check | Confirmed result |
| --- | --- |
| Cold finalized receipt | One Helius request, one Redis write; actual Devnet slot 517339032. |
| Redis restart | Exact stored result and original absolute expiry survived on the AOF volume. |
| Gateway restart | 20 identical receipt reads returned the same result with zero additional Helius requests. |
| Mutable balance | Two sequential balance reads each reached RPC; no balance TTL cache was introduced. |
| Real Redis stall | A disposable Redis server paused for 600 ms; fallback occurred before the full pause ended, then recovery passed. |
| Regression suite | 46 passed, zero failures or skips, using the exact deployed source and a real disposable Redis instance. |
| Runtime | Gateway and Redis healthy; public launch readiness and all-recorded-collection settlement evidence verified. |

The historical receipt is [this finalized Devnet transaction](https://explorer.solana.com/tx/5ped18mLzF3YVBzZcfL2W5LyxLgSfzM513UdpbUXqGPQHaD2rKVszct1ZbXxem5BEmqpDZb764thRT9aEjGVxSbV?cluster=devnet). Its canonical result SHA-256 was `e8c4bf324ad7cdccb956c7eb072f9ab6148688bc7eba423d8b65d43a52eadd9b` before and after both restarts. These are observed request savings for this controlled case, not an estimate of billed API credits.

Redis caches only non-null, explicitly finalized transaction and block history for 24 hours. The existing memory tier keeps history for at most five minutes without extending the original deadline. All RPC options are part of the hashed, genesis-scoped key. Balances, token/account state, quotes, blockhashes, signature statuses, nulls, errors, simulations and submissions remain outside Redis. Startup still verifies Devnet directly against the provider.

The cache has a 128 MiB LRU limit, a persistent AOF volume, a bounded command queue, disabled offline queuing and a hard 200 ms response deadline. Redis outages fall back to the existing gateway queue with cache backoff. The official client queue timeout alone did not bound a stalled response in the real integration test; the explicit deadline fixed that behavior. Redis exposes no host port and its internal network contains only Redis and the gateway. Only the gateway holds the provider credential; Redis holds no signing keys.

The deliberate gateway restart temporarily expired the agency worker's readiness. Its existing cycle reverified deployment evidence and restored public readiness before acceptance. No readiness guard was bypassed. At the final check the gateway recorded 7 Redis hits, 0 Redis errors, 0 upstream failures, 0 provider rate limits and 0 queue rejections since its restart.

The repository-wide source-size guard still reports the pre-existing `server/index.mjs` at 504 lines against a 500-line limit. It is unchanged from the pre-Redis parent and is absent from the gateway-only image. Every changed gateway runtime module fits the source budget.

The isolated test Redis was removed. No financial transaction was submitted by this verification. Changes are committed locally; no push was requested. Full measured evidence: [acceptance JSON](devnet-redis-cache-2026-11-01.json). Configuration and repeatable tests: [gateway documentation](rpc-gateway.md#redis-history-cache).
