# funded.vip v8 Devnet release — 2026-09-21

## Delivered

Build `creator-support-v8-20260921b` is healthy at the existing Docker origin `http://127.0.0.1:8788`. Image `fundedapp-app:creator-support-v8-20260921b`, ID `sha256:c1182abddf3c264430152e30fb7450f86af0b056089f329c91037f95c3edb1dd`. The approved public origin remains `https://funded.vip`; Cloudflare Access still returns a login redirect. Its existing policy, tunnel and database containers were not changed.

- Following: replaces the first-five-only refresh with explicit pages across up to 200 follows. Twenty creator rows per request and two updates each; empty follow lists never return global discovery. Previous/Next/Start over/Retry are accessible native buttons. Consent/follow changes invalidate in-flight results, including cross-tab changes. Unavailable accounts and limited coverage are disclosed.
- Privacy and proof freshness: reread current consent after slow receipt evidence. If financial inputs change during verification, require retry instead of publishing an old result. This covers creator pages, payout cards and paginated history, including cached media.
- Worker operations: persist safe batch outcomes separately from progress, fenced by lease ownership/expiry. Private status endpoint and CLI distinguish never-run, active, blocked, failed, aborted, stalled and stale. No owner IDs, cursors, signing keys or raw dependency errors appear in the report. The optional Compose receipt worker has no keeper or router authority environment.

The receipt worker was **not activated**. Deployed status is `never-run`, `coverageComplete:false`, `financialExecution:false`. Keeper transfers and development wallet behavior remain disabled. X OAuth and settlement are still blocked by configuration and evidence gates. No live transfer or real OAuth was performed.

## Evidence

31 checks passed: 30 local/mocked suites and disposable PostgreSQL integration. Final privacy/history and worker edge-case tests were rerun. Local and Docker builds passed; the existing 520 KB chunk warning remains. Final origin release verification passed, including authentication on the private ops route, empty-follow behavior, PostgreSQL storage, built assets/deep links and 20 parallel reads (41 ms; smoke only).

Browser QA used the real Portfolio with 45 synthetic followed profiles: pages 20/20/5, final Next disabled, Previous/Start over, outage Retry and page-two recovery after API restart. Consent-off cleared the feed. No horizontal overflow at 390 px. No wallet connected, identity authenticated or payout submitted. Synthetic preferences and temporary services/tab/viewport/database were cleaned up.

PostgreSQL baseline: 200 follows, 100 reads at concurrency 10, p95 5.5 ms. This is a small local synthetic read-model baseline, **not** a production capacity or million-user claim. It does not cover proxies, realistic data history, RPC quota exhaustion or multi-region failure.

## Backup, migration and rollback

Protected pre-release backup: `C:/Data/DevApps/funded.app/secrets/release-backups/funded-before-v8-20260921.dump`.
SHA256: `C1BEA5A01C806795E6AA23AEEBB80EE90C50D8B81364A02F3746C13954C76043`.

The dump archive validated and restored successfully into the task-owned disposable database. The additive `receipt_backfill.last_run` migration passed there before deployment. Original ledger counts matched before/after: coinChats 2, launches 1, referralChallenges 2. No actual app database restore or financial mutation was performed by testing.

The previous image remains as `fundedapp-app:rollback-before-v8-20260921` (v7 image ID `sha256:31b6618e92949da96e388181c11ebae56f2781836fc33fe36b48870fc5feb59b`). Under operator approval, override only the app image to that tag and use `up -d --no-deps --no-build app`; retain the additive schema and Access protection. Database restore is a separate destructive recovery decision: first reconcile post-backup activity and invalidate restored auth sessions. Never delete volumes or remove unrelated test containers.

## Release verification

```powershell
$env:FUNDED_RELEASE_BASE='http://127.0.0.1:8788'
$env:FUNDED_EXPECT_BUILD='creator-support-v8-20260921b'
$env:FUNDED_REQUIRE_POSTGRES='true'
node scripts/verify-release-contract.mjs
```

The deployed app uses `compose.preview.yml`, `compose.creator-devnet.yml`, and `compose.funded-vip.yml`, with the ignored `.env.deploy`. Preserve the immutable build/image tag; choose a new tag for subsequent code changes.

Worker status can be inspected inside the app container with `node scripts/receipt-worker-status.mjs`; add `--check` for a nonzero result on never-run/blocked/failed/stalled/stale states. `/api/ops/receipt-worker` requires the existing bearer API token; never place it in browser JavaScript, URLs or chat. Status reads perform no RPC or transfer. They report observed activity, not whether a stopped worker was intentionally disabled.

`compose.receipt-worker.yml` is optional, gated by the `receipts` profile. Review the intended RPC quota, monitoring ownership and stored-proof retention before enabling it. Each default batch handles at most five 12-record pages and waits 60 seconds between batches. It verifies registered receipt rows, not unknown transactions across the chain. Do not infer lifetime earnings from a completed pass.

## Remaining phases: not complete

| Phase | Remaining work / gate |
| --- | --- |
| 0 — Trust | Authenticate through Cloudflare Access for real HTTPS/cookie verification; prove Devnet recovery with expected state deltas; independent security review; durable metadata hosting. |
| 1 — Creation | Native file-picker end-to-end proof, real mobile-wallet/quote handoff, keyboard/screen-reader coverage beyond current checks, representative usability study. |
| 2 — Rewards | Approved X credentials and Devnet authority custody; actual collection, exact recipient payout, interruption recovery and graduation proofs; funded community/buyback execution. |
| 3 — Retention | Real cross-device OAuth, notification-provider selection/delivery, staffed moderation, consenting creator cohort and four-week retention evidence. |
| 4 — Sharing | Authenticated public-ingress check and separately approved crawler-access policy; durable hosting; approved gift/refund provider, integrations and retained-referral experiments. |
| 5 — Scale | Receipt-count scaling and remaining legacy financial writers, full-chain discovery/coverage, worker activation/monitoring, proof retention policy, durable hosted operations and realistic load/failover/recovery budgets. |

These are a mix of unimplemented engineering, operator/provider decisions and real-world validation—not successful production features. No mainnet activation, gifting purchase, provider signup, outreach, Access weakening or claim of virality was authorized by this delivery. The immediate operator action is to sign in through the existing funded.vip Cloudflare Access tab; keep all private credentials in the protected environment.
