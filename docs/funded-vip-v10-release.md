# funded.vip v10 — scoped referral transitions and keyboard recovery

## Observed deployment

Deployed on 2026-09-21 to the approved **Devnet** Docker origin at `http://127.0.0.1:8788` using the existing tunnel. Build `creator-support-v10-20260921a`; API `creator-support-v10`; image `fundedapp-app:creator-support-v10-20260921a`, ID `sha256:b7cba299622056e847b5ca741b7798a1c0a06dc890aa1d60a00fb1f1d817cb5d`. App health is healthy. Only the app container was replaced; PostgreSQL, tunnel, volumes and Cloudflare Access were retained.

Public `https://funded.vip/api/capabilities` still returns 302 to Cloudflare Access. Authenticated public-ingress verification is **blocked pending user sign-in**. This is not a mainnet release or evidence of a live payout.

## Delivered

- **Phase 5:** referral verification and execution transitions use indexed claim/payout reads and a claim-specific PostgreSQL transaction instead of hydrating/locking the whole ledger. Shared coordination locks preserve compatibility with legacy whole-ledger writers; unrelated referral claims can progress independently. The wallet-facing referral projection is updated atomically. File fallback remains serialized whole-file persistence.
- **Phases 0/2:** immutable referral recipient, amount, asset, source, level, nonce and expiry; paid-claim/payout immutability; one execution contender; matching payout amount/destination/signature and paid status commit together. New payouts use a deterministic `referral:<claimId>` key. Historical random payout IDs remain readable and unchanged. Conflicting canonical keys cannot overwrite another receipt. Unknown or uncertain states fail closed and require reconciliation.
- **Phase 2:** disabled/unconfigured keeper execution is rejected before changing the claim. A verified claim no longer becomes stranded in `verification-pending` merely because execution was disabled. Real send/confirmation failures still require reconciliation; no automatic payout retry was introduced.
- **Phase 1:** wizard step changes focus the visible panel heading; hidden/closed panels are never focused. Reduced-motion scrolling is respected. Validation has a polite live status and describes Continue. Escape and the close button use the same route cleanup, returning to Overview and restoring the launch opener where available.
- **Phase 1:** router verification outages use clear save-draft/retry guidance rather than rendering raw RPC JSON or mislabeling every exception as invalid configuration. Signing remains blocked.

This does not finish every phase. Referral preparation, collection/settlement and entitlement creation still use legacy writes. No economic policy, provider, on-chain program, custody configuration or Access policy was changed.

## Evidence

**35 checks passed:** 34 local/mocked suites plus disposable PostgreSQL integration. The added suites are `verify:referral-scoped-store`, `verify:launch-accessibility`, and expanded `verify:referral-server`. Local/Docker production builds and `git diff --check` passed; the existing 520 KB chunk warning remains.

Scoped store tests cover file/PostgreSQL parity, twenty concurrent same-claim updates plus a legacy write, independent progress for another claim, mutation rollback, immutable entitlement/wallet checks, invalid IDs, single execution lock, exact atomic payout, immutable paid receipts, historical payout lookup and conflicting payout-key preservation. PostgreSQL also verifies the referral wallet projection becomes paid in the same transaction. These use synthetic claim/payout records only, not transferred SOL.

HTTP tests use an isolated fixture store and **in-memory ephemeral signing keys**: prepare, sign, verify, attempt execution with the keeper disabled, then reread and confirm the claim is still wallet-verified. No key is persisted and no transfer is broadcast. Existing collection/settlement authorization and zero-fee rejection checks also pass.

Browser checks used the built wizard on an isolated fixture API with outbound fetch disabled. Keyboard activation focused Coin; entering synthetic name/ticker and activating Continue focused Benefits; Back returned focus to Coin. Escape closed the dialog, changed the route to Overview and restored focus to Create coin. The final rebuilt version showed polite validation and the readable outage message. No wallet connected, metadata uploaded or transaction signed. This is not a screen-reader certification, mobile-wallet test or representative usability study.

The final deployed-origin release contract passed: matching API/build, Devnet, PostgreSQL storage, deep links/assets, private-ops authorization, empty-follow behavior and twenty parallel reads (62 ms, smoke only). It is not a throughput, service-level or million-user capacity result.

Observed false flags: `DEV_MODE`, `DEVNET_TEST_MODE`, `SOLANA_ALLOW_KEEPER_TRANSFER`, `FUNDED_RECEIPT_BACKFILL_ENABLED`, `FUNDED_RECEIPT_RETENTION_ENABLED`. Keeper/router credentials and X OAuth credentials remain absent. No embedded environment files or secrets directory were found. Worker status remains `never-run`, `coverageComplete:false`, `financialExecution:false`; payout readiness remains blocked.

## Backup and recovery

Protected backup: `C:/Data/DevApps/funded.app/secrets/release-backups/funded-before-v10-20260921.dump`.
SHA256: `5D96FE3DF09030BAA76BF570036300C0C3069E0BDB87A106A456826424D59552`.

It restored successfully into the task-owned disposable PostgreSQL instance; startup migration succeeded there before deployment. Original ledger counts stayed `coinChats:2`, `launches:1`, `referralChallenges:2` after deployment. No live ledger was restored or changed by the fixture tests. Temporary database, API, tab and synthetic fixture file were removed; protected backups remain.

Rollback image: `fundedapp-app:rollback-before-v10-20260921`, ID `sha256:b47b9a1b35abccb31bef04db3d237545775b87f9351483cb7951d1f70050585d` (v9). Under operator approval, override only the app image and use `up -d --no-deps --no-build app`; retain database, tunnel, volumes and execution-disabled settings. Database restore is a separate destructive recovery decision requiring reconciliation of post-backup activity and session invalidation. Do not remove unrelated Docker containers.

## Remaining acceptance gates

| Phase | Not yet complete |
| --- | --- |
| 0 — Trust | Authenticated public HTTPS/session checks; real Devnet launch/recovery state deltas; independent security/custody review; durable metadata hosting. |
| 1 — Creation | Real wallet/quote and mobile handoff; end-to-end signed upload with a wallet; broader keyboard/screen-reader coverage and user study. |
| 2 — Rewards | Approved X/provider credentials and Devnet authority custody; actual collection/exact payout/recovery/graduation evidence; funded community/buyback execution. |
| 3 — Retention | Real cross-device OAuth; notification-provider integration; staffed moderation; consenting creator pilot and four-week retention evidence. |
| 4 — Sharing | Approved crawler-access policy and durable hosting; gifting/refund provider and integration; retained-referral experiments. |
| 5 — Scale | Scoped referral preparation, collection/settlement and entitlement writers; creator-history scaling; full-chain discovery; worker activation/monitoring; retention policy; realistic load/failover/recovery budgets and hosted operations. |

Engineering remains alongside external decisions and real-world evidence. The operator needs to sign in to funded.vip's existing Access flow and identify approved durable hosting/metadata, notification, and gifting/refund providers before those integrations can proceed. Credentials stay in the protected environment, never in chat. No mainnet activation, live payout, provider signup, Access weakening, automated outreach or claim of guaranteed virality was performed.
