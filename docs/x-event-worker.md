# X event worker setup

The intended account is **@johntrand83** (`X_POST_EXPECTED_HANDLE=johntrand83`). Posting is currently disabled: no dedicated posting credential is bound, the user has not approved public Devnet announcements, and the workspace preview is not a verified public HTTPS origin. This worker is separate from the hourly engineering automation.

## Image and data

Build and verify a new application image containing `scripts/run-x-post-worker.mjs` before selecting it with `FUNDED_APP_IMAGE`. The existing workspace preview uses an earlier source snapshot; do not assume the new CLI is present in that running image. The optional `compose.x-post-worker.yml` must be combined with `compose.devnet-release.yml`; its `x-posting` profile is never included in the normal stack.

The worker shares PostgreSQL, the configured Devnet RPC secret and a read-only application data volume. `AUTOMATIC_REWARD_STORE_PATH` matches the web service's reward ledger. Set `FUNDED_TOKEN_MINT`, `FUNDED_FEE_ROUTER_PROGRAM_ID` and the public `FUNDED_REWARD_AUTHORITY` address to the verified Devnet identities for the deployed application; missing source configuration is a coverage gap, not evidence that no events happened. No Solana wallet, keeper key, payout key or browser-login credential is mounted.

## Configuration and account authorization

| Setting | Required value or purpose |
| --- | --- |
| `X_POST_EXPECTED_HANDLE` | `johntrand83`; the publisher checks `/2/users/me` before dispatch |
| `X_POST_ACCOUNT_ID` | Optional numeric account ID, recommended as an additional identity check |
| `X_POST_PUBLIC_ORIGIN` | Verified public HTTPS app origin, without a path; localhost preview does not qualify |
| `X_POST_START_AT` | Explicit ISO activation watermark at or before now; select deliberately to avoid unintended historical announcements |
| `X_POST_ACCESS_TOKEN_FILE` | Private host file containing a dedicated user-context posting token; mounted only on this worker |
| `X_POST_ENABLED` | Defaults `false`; executing publication requires `true` and `--execute` together |
| `X_POST_ALLOW_DEVNET` | Defaults `false`; requires explicit approval for publicly labeled Devnet announcements |
| `X_POST_INTERVAL_MS` | Compose fixes polling at `60000` milliseconds |
| `X_POST_MAX_PER_PASS` | Compose caps each pass at `1` post |
| `X_POST_MAX_HOURLY` | Compose caps publication at `6` per hour |
| `X_POST_MAX_DAILY` | Compose caps publication at `24` per day |
| `X_POST_MIN_PROFIT_LAMPORTS` | Compose requires at least `1000000000` lamports for qualifying profit events |
| `FUNDED_TRADE_FEE_OWNER` | Public address of the app's fee recipient; must match the web service for strict trade-cost verification |

Authorize an X user-context token for this specific account with the provider's required `tweet.write` and `users.read` permissions, plus any required companion scopes such as `tweet.read`. App-only bearer tokens and the app's identity-only browser login are insufficient. The existing login flow does not request posting access and does not retain a reusable posting token.

**Automatic token refresh is not implemented.** Track expiry in the secret manager, rotate the dedicated token through the authorized account flow, replace its private secret file and recreate only the worker to load it. Revocation or expiry must remain a visible blocked state. Never paste tokens into command arguments, source, reports or chat. Keep the host secret directory private and permit the container's nonroot user to read only its mounted file.

## Draft inspection before any publication

The CLI supports `--once` (the default), `--loop`, and `--status`. Without `--execute`, both once and loop prepare drafts and may verify finalized evidence through Devnet RPC, but make **zero X API calls**. Draft preparation writes durable outbox/cursor state, so inspect the selected account, start watermark and database before running it. `--status` reads the delivery state without publishing. These modes still require valid account, origin, watermark and database configuration.

The supplied Compose command is `node scripts/run-x-post-worker.mjs --loop`, with both enable flags false. A reviewed deployment override would need to add `--execute` as well as satisfy both flags before public dispatch is possible. Do not enable this override until Devnet posting policy and the destination account are approved. A preflight must also verify that the public origin reports the expected Devnet cluster and PostgreSQL session storage.

Provider timeouts and ambiguous delivery outcomes require reconciliation against the account before any retry. Inspect blocked/unknown delivery states, receipt links and rate-limit windows rather than treating a process that is running as proof of successful delivery. Local tests and draft output do not prove live X authorization or publication.

In the managed Docker environment, extend the worker with the same read-only proxy CA mount, `NODE_EXTRA_CA_CERTS`, `NODE_USE_ENV_PROXY` and outbound proxy settings used by the web service. Never bake credentials or the session CA into the image. A sleeping free web service cannot guarantee continuous dispatch; an always-on worker and durable shared PostgreSQL are needed for reliable event processing. No worker was started or X post sent by this setup.

## Integration checks

`npm run verify:x-post-recovery` provisions its own disposable Docker PostgreSQL instance, backs up both posting tables, removes the source database and restores into a new database. Seven checks passed for exact state, caps, cursor, replay protection and two-worker dispatch of only pending records. This is a quiesced fixture; restore of a live account must reconcile any X posts accepted after the backup before dispatch resumes.

CI provisions a separate disposable PostgreSQL service at the harness-guarded loopback port/database. It runs `npm run verify:x-post-outbox`, then `npm run verify:x-post-cycle`, then `npm run verify:x-post-draft`. The first harness resets that isolated database schema; never point these commands at application data. These checks exercise durable delivery, synthetic verified-source collection and actual CLI draft/status subprocesses with a network trap. They do not contact X or establish live posting authorization. `npm run x:posts -- --status` is the configured worker status entrypoint; do not run it until the selected database and account settings are reviewed.

## Event coverage and limits

Launches and paid listings require finalized Devnet receipts matching the registered identity. Project rankings use verified SOL rewards paid within the complete UTC day, not trading volume. Daily reward summaries report the recorded verified total, count and largest payment. They require the complete reward ledger and original claim entitlements; unsupported assets, self-funded payouts or missing evidence block the summary.

The current daily verifier checks the full paid history, bounded to 100 records by default. Beyond that budget it blocks instead of presenting a partial ranking. A complete indexed interval provider is required before scaling this coverage. Both daily summaries reuse verification within a poll and reverify on the next poll.

Profit summaries support a narrow direct native-SOL Pump round trip with an initially empty token account, complete intervening account history, exact protocol/application/network fees and purpose-specific wallet consent for this account, origin and receipt pair. Rent setup, unrelated transfers, ambiguous routes, cashback and incomplete costs are rejected. These checks have synthetic receipt coverage; live financial and X publication acceptance remains outstanding.

The web service separately requires `X_PUBLIC_TRADE_SHARES_ENABLED=true`, the same `X_POST_EXPECTED_HANDLE` and `X_POST_PUBLIC_ORIGIN`, and matching public `FUNDED_TRADE_FEE_OWNER` configuration to accept sharing consent. This does not enable the posting worker. The challenge and consent endpoints under `/api/x-public-trade-shares/` bind the wallet's signed statement to the exact pair of receipts, public account and origin. They enforce expiration, one-use acceptance, idempotent retries, request limits and independent trade verification before saving a consent record. Merely connecting a wallet or sharing a link grants no posting consent.

Pending items retain their original immutable text and oldest-first order. Posting caps can create a backlog; review old queued items before enabling or resuming public delivery. The worker does not silently delete pending records, automatically replay uncertain posts or refresh expired X credentials.


## Incremental collection boundaries

The collector keeps deterministic event IDs for the current timestamp boundary. A source inserted later with that same timestamp is still considered, even when its ID sorts before an event already queued. Boundary IDs and pending verification retries are persisted atomically with the outbox. A legacy cursor without these IDs requires the durable outbox lookup before it can safely resume; without that lookup the stream stops with a diagnostic.

The bound is 500 IDs at one timestamp and 200 pending verifications per stream. A full boundary stops before advancing past an unseen record and reports `Timestamp boundary capacity is full`. Operators should pause dispatch, preserve the cursor and outbox, and reconcile the source interval against durable event IDs using a reviewed indexed backfill before resuming. Do not delete outbox records or move the activation timestamp to silence this diagnostic. This incremental guarantee covers the current timestamp only: older backdated insertions behind an advanced timestamp require the same separate reconciliation.

Daily reward summaries continue to verify the complete recorded payout set within their configured budget. Decimal SOL amounts are parsed into exact integer lamports, including canonical numeric exponent notation; sub-lamport values and totals beyond safely comparable RPC balances are rejected without rounding. Focused tests use synthetic receipts, including a 15-lamport payout, and do not establish live chain or X publication results.
