# Audit fixes F01–F14

Implemented on top of `bcb9b950507d69fadc74dd6cc16c821342b9294a`. The supplied audit reviewed an older commit. F15 is excluded. Existing unrelated edits were preserved. The unit-test files were removed after the verification recorded below, at the user's request.

| Finding | Change |
|---|---|
| F01 | Removed the generic completed GET cache. Only allowlisted public reads share in-flight requests. Headers are normalized with `Headers`; authenticated, wallet-scoped and explicit refresh requests bypass sharing. Subscribers cancel independently. |
| F02 | Birdeye uses a bounded serial queue with actual-start spacing, cooldowns, HTTP `Retry-After`, cache/in-flight reuse and queue metrics. |
| F03 | Free-provider requests use bounded per-host queues; waits are never shortened to five seconds. Trading retains its separate priority lane. Expired stale windows are no longer served indefinitely. |
| F04 | Added scoped PostgreSQL boost quote, payment-journal, confirmation and admin-boost transactions. Locks coordinate with legacy writers and isolate unrelated mints; quote/signature checks and rollback are preserved. Watchlists, chat, wallet authentication and claims already had targeted repository methods in this checkout. The generic whole-ledger method remains as a compatibility path for other operations; this is not a rewrite of every ledger caller. |
| F05 | Added transactionally maintained `discovery_entries`, a one-time backfill, cluster/mint indexes and bounded paginated registry reads. PostgreSQL discovery uses this projection and cached market ranking instead of `store.read()`. File-backed development stores retain their compatibility path. Concurrent identical registry refreshes share work. |
| F06 | Removed recursive startup preloading. Optional creator/reward/financial features load on relevant routes. Added desktop/mobile hero variants and responsive selection. Core app controllers still load during startup; the audit's aspirational total route-JavaScript target is not claimed achieved. |
| F07 | Removed pathname-wide 503 suppression. A failed wallet/query does not block another request or an explicit retry. |
| F08 | Live response cache has a 200-entry / 4 MiB approximate string-storage bound, LRU eviction and expiration sweeps. Wallet changes and writes invalidate it; older in-flight reads cannot repopulate a new generation. Authenticated requests and explicit refreshes bypass it. |
| F09 | Legacy RPC caching is limited to non-null finalized transaction/block proofs. Balances, accounts, blockhashes and preflight reads are uncached. |
| F10 | Incomplete zero-volume history is labeled unverified; missing values are not converted into verified zero. Other financial metrics use a generic partial-history label. |
| F11 | Cards have one “Review trade” amount menu. Selecting an amount navigates to the token review page; card clicks no longer initiate wallet signing. Menus escape card clipping and preserve keyboard focus. |
| F12 | Removed fixed 1.3-second Birdeye retries during cooldown. Retained display data carries freshness metadata. |
| F13 | Holder/ATH enrichment targets the visible page. Gecko holder lookup is skipped when Jupiter has a usable count. DexScreener order metadata is cached for 24 hours. |
| F14 | Added a persistent configured-network badge, explicit real/test SOL and read-only wording, reward-state explanations, and promotion/brand disclosures. No domain or network configuration was changed. |

## Verification

- `npm run check`: 1,214 JavaScript files checked; size budgets passed for 1,461 maintained code files.
- Before unit-test removal, `node --test tests/*.test.mjs`: 658 passed, 0 failed, 1 skipped. The skipped test requires an explicitly supplied disposable database URL and was run separately successfully.
- `npm run build`: passed. Separate Mainnet review build passed.
- Mocked regression probes: session/header isolation, independent cancellation, explicit refreshes, 30 simultaneous distinct Birdeye keys, provider cooldowns, 10-request Gecko spacing, queue overflow/cancellation, bounded live cache, uncached balances and missing proofs, cooldown retry suppression and visible-page enrichment.
- Disposable PostgreSQL 17: real transactions verified rollback, duplicate quote rejection, unrelated-mint concurrency, registry paging, cluster isolation and projection changes/deletion. Test container and its volume were removed after testing.
- Local database scale probe, 100 samples per size:

| Unrelated ledger entities | Boost write p95 / p99 | Discovery p95 / p99 |
|---:|---:|---:|
| 10,000 | 16.66 / 22.82 ms | 2.49 / 3.79 ms |
| 100,000 | 21.04 / 27.78 ms | 2.93 / 3.33 ms |
| 1,000,000 | 18.97 / 28.57 ms | 2.83 / 4.67 ms |

These test unrelated ledger growth, not production concurrency or a million registered tokens/receipts on one mint.

- Mainnet review HTML: **19 modulepreloads, 33,044 bytes gzip**. This measures initial preload references, not all JavaScript subsequently loaded by the application. The audit's 73 / ~541 KB figures came from its older revision.
- Optimized hero variants: desktop **109,692 bytes**, mobile **32,548 bytes**. The current Mainnet design can use its newer SVG banner instead; the optimization applies where the older artwork is used.
- Focused local browser checks at **360, 390, 768, 1440 px**: network badge, responsive asset selection, review-menu navigation, no trade submission, no script errors and no horizontal overflow passed. Screenshots and results are in `tmp/audit-ui/`.
- Existing read-only browser suite: **34/36 passed**. The two token-page checks failed on a **404 from `/api/tokens/:mint/creator`**. Pre-existing local edits added that endpoint and its caller; the production API behind the review proxy does not expose it. Those edits were not changed or deployed by this work.

## Release limits and operational notes

Database migration includes new indexes, a projection trigger and one-time backfill; inspect migration duration against a staging copy before deployment. Display ranking uses cached market data and is not a trading quote.

Provider `providerStats()` exposes actual transport calls, cache/coalescing counts, failures, queue delay and cooldown state. `billedCredits` is explicitly `null`; no billing-dashboard integration or cost-savings percentage is claimed.

No real wallet was connected, no transaction was signed, and no on-chain payment or payout was verified. Production load behavior, actual billed credits and field LCP/INP remain unverified. The two existing-browser-suite failures described above prevent claiming an entirely green production-backed suite.

Repeat the focused checks with `node scripts/review/build-mainnet.mjs` and `node scripts/review/with-server.mjs node scripts/review/audit-fixes.mjs`. `scripts/audit-db-scale.mjs` requires `AUDIT_TEST_DATABASE_URL` pointing to the explicitly named local disposable `funded_audit` database; it never consumes `DATABASE_URL` or local environment files.
