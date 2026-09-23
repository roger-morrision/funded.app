# funded.vip v7 Devnet release — 2026-09-21

## Deployed, with public verification blocked

The user approved `funded.vip` and the existing Docker/tunnel deployment. Only `fundedapp-app-1` was replaced; the existing PostgreSQL volume, database container, tunnel and Cloudflare Access policy were retained. No mainnet, financial authority, transfer, real X OAuth or automatic receipt worker was enabled.

- Image: `fundedapp-app:creator-support-v7-20260921a`
- Running image ID: `sha256:31b6618e92949da96e388181c11ebae56f2781836fc33fe36b48870fc5feb59b`
- API contract: `creator-support-v7`; build: `creator-support-v7-20260921a`
- Origin: `http://127.0.0.1:8788`; public configuration: `https://funded.vip`
- Health: healthy. Release contract passed at the origin: PostgreSQL-backed sessions/directory, built assets, deep links, disabled chat and 20 parallel capability reads (44 ms, smoke only).
- `DEV_MODE`, `DEVNET_TEST_MODE`, `SOLANA_ALLOW_KEEPER_TRANSFER`, `FUNDED_RECEIPT_BACKFILL_ENABLED`: all `false`. Keeper/router signing credentials absent. Image checked to exclude `.env.local`, `.env.deploy` and `secrets`.
- Browser at origin: creation wizard renders with Devnet labels, wallet disconnected and explicit X-support blockers. HTTPS currently returns Cloudflare Access sign-in; authenticated ingress, cookies, OAuth and social-crawler rendering remain unverified.

The Cloudflare skill guided preserving the existing protected route. No DNS, tunnel routing, certificate or Access policy was changed. [Cloudflare published-application routing documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/) was consulted before deployment.

## Verification and backup

28 local/mocked suites plus disposable PostgreSQL integration passed, as did local and Docker builds. A 520 KB bundle warning remains. See the [phase evidence](phase-delivery-status-2026-09-21.md) for distinctions between source, mocks and deployed observations.

Pre-release backup: `C:/Data/DevApps/funded.app/secrets/release-backups/funded-before-v7-20260921.dump`, protected to the current Windows user and SYSTEM, ignored by Git and Docker build context. SHA256: `3800382E87FB0CA2C4D418BC85229BD17072A9AF3B68174D532494AC51BB7A53`.

The custom-format dump passed archive validation and restored into the disposable PostgreSQL container, never over the app database. Ledger counts matched: coinChats 2, launches 1, referralChallenges 2. The new migration also passed against that restored copy. After actual deployment, these original ledger counts were unchanged and creator-directory projection version was 2. This proves this small backup/restoration and additive migration, not large-scale recovery time or live payout correctness.

## Reproduce the target

From the repository, with the existing protected `.env.deploy`:

```powershell
docker compose --env-file .env.deploy -p fundedapp -f compose.preview.yml -f compose.creator-devnet.yml -f compose.funded-vip.yml config --quiet
docker compose --env-file .env.deploy -p fundedapp -f compose.preview.yml -f compose.creator-devnet.yml -f compose.funded-vip.yml up -d --no-deps --no-build app
$env:FUNDED_RELEASE_BASE='http://127.0.0.1:8788'
$env:FUNDED_EXPECT_BUILD='creator-support-v7-20260921a'
$env:FUNDED_REQUIRE_POSTGRES='true'
node scripts/verify-release-contract.mjs
```

Do not reuse an immutable image tag after changing code; assign a new build/image ID. Do not run `down -v`, remove orphans or replace the database/tunnel for an app-only release. The similarly named test containers predated this work and are not release cleanup targets.

## Rollback material

Previous image preserved as `fundedapp-app:rollback-before-v7-20260921`, ID `sha256:4de5bd0b5c7bbdb64949eb9ea8a1e5e412655eb8126fab0c82769615d02d809e`. Keep the additive schema if rolling back the app. Under operator approval, override only `services.app.image` with that tag and use `up -d --no-deps --no-build app` with the same protected environment and overlays. Never rebuild an old tag from current source. Retain Cloudflare Access and keep sign-in/financial execution closed because the older app lacks these safety changes.

Restoring the database is a separate destructive recovery decision, not a routine image rollback. Take a fresh backup before any restore, reconcile post-backup activity and invalidate restored sessions/OAuth records before reopening sign-in. The protected pre-release dump remains available; no production database restore was performed.

## Registered-receipt backfill

Source entrypoint: `npm.cmd run receipts:backfill`. It requires an explicit Devnet store and `FUNDED_RECEIPT_BACKFILL_ENABLED=true`; the release keeps it disabled. Default batches cover at most five 12-record pages, use a two-minute fenced database lease, persist finalized evidence and stop without checkpoint advancement on RPC/storage unavailability. `--watch` waits 60 seconds between batches. It never signs or transfers funds. A completed pass means registered eligible records, not all chain transactions or lifetime earnings. Review RPC budget, retention and monitoring before activation; use PostgreSQL for multiple processes.

## Remaining operator gates

Authenticate in the open funded.vip Cloudflare Access tab for public-ingress verification. Configure approved X credentials and authority custody separately, then prove Devnet collection/recipient deltas/recovery/graduation with ephemeral wallets. Mainnet, durable hosted metadata, gifts/refunds, email/push, moderation and adoption experiments are not complete.
