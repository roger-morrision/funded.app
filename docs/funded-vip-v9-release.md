# funded.vip v9 — receipt counters, cache maintenance and image accessibility

## Deployed result

On 2026-09-21 the approved Docker origin was updated to `creator-support-v9-20260921a` on **Devnet**. Image: `fundedapp-app:creator-support-v9-20260921a`; observed image ID: `sha256:b47b9a1b35abccb31bef04db3d237545775b87f9351483cb7951d1f70050585d`. The app is healthy at `http://127.0.0.1:8788`; the API reports `creator-support-v9`.

Only the app container was replaced. The existing PostgreSQL database, tunnel and Cloudflare Access policy were retained. The public capabilities URL still returns a 302 to Cloudflare Access, not an authenticated application response. Public HTTPS/session behavior is **blocked pending user sign-in**, not verified.

## Implemented

- Receipt-count scaling: recent receipt reads now get exact eligible-record counts from keyed `receipt_counts`, rather than counting all eligible ledger rows on each read. Transactional PostgreSQL triggers cover insert/update/delete, legacy writes and scoped payout writes; status/signature/cluster changes adjust counts, unchanged eligibility cancels out. A versioned migration builds counters once from existing rows. Counts describe recorded candidates, not verified funds or complete chain history.
- Proof-cache maintenance: explicit-store, Devnet-only CLI defaults to a bounded dry run. Applying requires an explicit flag and enable variable; cutoff must be at least seven days old, batches at most 500. It only evicts derived finalized-proof cache entries, never collection/payout/claim/session records. Fresh proofs survive; PostgreSQL skips locked entries during concurrent refresh. No cleanup ran against the deployed database and no automatic retention policy was enabled.
- Creation accessibility: the image input is now keyboard-reachable, named, described, and has a visible focus outline. The native input covers the existing picker; image preparation, optional crop and removal remain local until the separate signed metadata workflow.

## Verification

**32 checks passed:** 31 local/mocked suites plus disposable PostgreSQL integration. Local and Docker builds passed. Existing 520 KB chunk warning remains.

The new PostgreSQL checks compare counters against an independent ledger scan after eligibility edits, cluster moves, invalid signatures, no-op upserts, concurrent inserts, deletion, rollback, populated-store migration, restart and transactional truncate/rollback. Existing scoped-claim tests run before this comparison. Maintenance checks cover dry run, bounded application, fresh-proof preservation, ledger immutability and concurrent locked-proof refresh. These are synthetic database tests, not on-chain financial evidence.

Browser QA used the actual built wizard against an isolated fixture API with outbound fetch disabled and no wallet connected. Tab moved from ticker to image input with visible focus; Space opened the file chooser. Selecting a generated synthetic PNG prepared it to **1024 × 538, 30 KB**; square crop produced **538 × 538, 20 KB**; Remove returned “No image selected” and cleared logo readiness. This closes the native-picker test gap, not signed upload or real mobile-wallet verification. Temporary tab/API and generated files were cleaned up.

Final deployed-origin release contract passed: correct build/version, Devnet, PostgreSQL-backed storage, built assets/deep links, private-ops authorization, empty-follow behavior and 20 parallel reads (41 ms; smoke only). This is not a realistic capacity test or a million-user claim.

Observed execution controls remain false: development mode, development wallet mode, keeper transfers, receipt backfill, receipt retention. Keeper/router authority and X OAuth credentials are absent. No embedded `.env.local`, `.env.deploy` or `secrets` directory was found in the image. Worker status remains `never-run`, `coverageComplete:false`, `financialExecution:false`. Payout readiness remains blocked. No actual transfer, OAuth login, metadata upload or receipt cleanup occurred.

## Backup and rollback

Protected backup: `C:/Data/DevApps/funded.app/secrets/release-backups/funded-before-v9-20260921.dump`.
SHA256: `95CC4F9121699FEF38CD991775C3FB82DCA3FD271AAD6678C603AF8AEB5FB860`.

The backup restored into a separate database in the task-owned disposable container. The new migration passed there before deployment. Before/after original ledger counts matched: `coinChats:2`, `launches:1`, `referralChallenges:2`. The deployed database now records receipt-count read-model version 1; it has no eligible collection/payout rows and therefore no counters. Synthetic fixtures separately exercised populated receipt migration.

Previous image retained as `fundedapp-app:rollback-before-v9-20260921`, ID `sha256:c1182abddf3c264430152e30fb7450f86af0b056089f329c91037f95c3edb1dd`. Under operator approval, replace only the app image using `up -d --no-deps --no-build app`, retaining the additive schema. The triggers remain compatible with v8 writes. Restoring the database is a separate destructive decision: reconcile post-backup activity and invalidate restored auth sessions first. Never delete app volumes or unrelated containers.

## Maintenance runbook — disabled by default

1. Review archive-RPC availability, backup/restore, retention duration and monitoring ownership. Evicted proofs require fresh finalized verification; if archived transactions are unavailable, affected receipts must remain unverified. Neither a purge nor a completed backfill proves lifetime coverage.
2. Use an explicit protected `DATABASE_URL` or isolated `FUNDED_STORE_PATH`; do not paste credentials into shell history or reports. The CLI does not load local environment files. File-store override wins if both are set.
3. Dry run with `npm.cmd run receipts:retention -- --before=2026-08-01T00:00:00Z` (example only; choose the reviewed cutoff). `FUNDED_RETENTION_BATCH` defaults to 100 and allows 1–500. Review `selected`, `hasMore`, scope and warning.
4. Only after backup and operator approval, set `FUNDED_RECEIPT_RETENTION_ENABLED=true` for that process and add `--apply`. Do not permanently enable the app's deployment flag. Rerun a dry run afterward. Applying skips locked rows; `hasMore:false` does **not** prove that no locked eligible entries exist. There is no scheduled deletion or automatic loop.
5. Record aggregate results without receipt payloads, signatures, user identities or credentials. Ledger records are never deletion targets. Retained backup and source records make reconstruction possible subject to finalized archive-RPC availability.

## Still incomplete

| Phase | Remaining acceptance work |
| --- | --- |
| 0 — Trust | Authenticated funded.vip HTTPS/session test; real Devnet recovery state deltas; independent security/custody review; durable metadata hosting. |
| 1 — Creation | Real wallet/quote and mobile handoff; signed metadata upload; broader keyboard/screen-reader and representative usability tests. |
| 2 — Rewards | Approved X credentials and Devnet authority custody; actual collection, exact recipient payout, recovery and graduation proof; funded community/buyback execution. |
| 3 — Retention | Real cross-device OAuth; notification-provider integration; staffed moderation; consenting creator pilot and four-week study. |
| 4 — Sharing | Crawler access decision without weakening Access by assumption; durable hosting; approved gift/refund provider and implementation; retained-referral experiments. |
| 5 — Scale | Remaining legacy financial writers and creator-history scaling; full-chain discovery; worker activation/monitoring; operational retention policy; realistic load/failover/recovery budgets and hosted operations. |

The remaining work includes unfinished engineering as well as configuration, provider decisions and real-world validation. These phases are **not all complete**. Vanity inventory, additional chains, LaunchLab expansion and altered referral economics remain deferred by the original roadmap. No mainnet rollout, external provider signup, automated outreach or guarantee of virality is part of this release.

## Source reference

Trigger behavior was checked against PostgreSQL 17's primary documentation: [CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html) and [PL/pgSQL trigger functions](https://www.postgresql.org/docs/17/plpgsql-trigger.html). Runtime correctness is supported by the disposable integration tests above, not documentation alone.
