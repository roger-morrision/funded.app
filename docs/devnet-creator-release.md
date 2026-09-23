# Creator v3 Devnet release handoff

Historical v3 batch: the current deployed Docker-origin contract is **creator-support-v10**. See [v10 deployment evidence](funded-vip-v10-release.md) and the [latest phase status](phase-delivery-status-2026-09-21.md). The remaining text records the historical v3 batch, not current deployment status.

Status: prepared locally, **not deployed**. This is a review checklist, not authorization to enable financial execution or mainnet.

## Changes in this batch

- X sign-in uses a browser-bound, single-use PKCE request. Requests survive restart and are consumed atomically by PostgreSQL. Sessions use random bearer cookies; only their hashes are persisted. Absolute expiry is 24 hours; logout revokes server-side state. CSRF survives restart. X access/refresh tokens are not retained after profile lookup; no offline or posting scope is requested.
- `GET /api/creators` uses the `(cluster, creator_id)` PostgreSQL directory projection and keyset pagination, fetching at most 51 small public rows. Launch/profile mutations update it in the same transaction, including opt-outs, changed beneficiaries and deletions. Substring search still scans directory search text; this is not an indexed full-text search or a million-user capacity claim. Financial writes and detailed creator pages still load ledger state and remain scaling work.
- Creator update and individual payout PNG cards are explicitly downloadable. Update cards identify the account/date without truncating or mistranslating arbitrary Unicode post text. Receipt cards require the existing matched collection/entitlement/payout proof join on every request, even for cached images. Missing proof, exclusion or removed updates fail closed. No automatic posting, gifts or lifetime earnings claims.
- Corrupt local journal event arrays show an uncertain outcome instead of crashing Portfolio or implying completion.

## Evidence

20 verification suites passed in this batch: x-auth, x-auth-http, creator-support, adoption-phases, launch-matrix, launch-wizard, mint-router-v2, receipt-evidence, explore-discovery, coin-detail, production-policies, proof-ui, fee-policy, backend-hardening, wallet-state, x-payout, pump-trading, devnet-metadata, postgres-store and release-contract. Build and diff checks passed. Existing 520 KB bundle warning remains.

The auth HTTP fixture runs the real API but mocks X responses and rejects other outbound server requests. It proves restart between OAuth start/callback and after login, rejection of wrong-browser/replayed callbacks, persistent creator CSRF, preferences and logout. It is **not a real OAuth test**. PostgreSQL checks use a new disposable container at `127.0.0.1:15435/funded_test`, not any existing app database. Directory query parity, concurrent state and cross-instance sessions passed.

Browser: a clearly labelled synthetic profile on isolated port 5175 rendered the new update-card control. Clicking it produced the download confirmation; the returned PNG was visually inspected. No wallet connected. Receipt eligibility/cache invalidation was tested with mocked evidence, not a live payout.

Read-only release observations on 2026-09-21: isolated port 19020 reports `creator-support-v3`; existing preview 5174 reports `creator-support-v2`; existing Docker port 8788 returns 404 for `/api/capabilities`. Existing services were not restarted. A 20-request local read smoke is not a production load test.

## Operator decisions and prerequisites

1. Confirm the intended Devnet deployment target and a durable HTTPS app origin. Existing Docker/PostgreSQL can be reused; no hosting migration is necessary for these code changes.
2. Configure `PUBLIC_APP_URL` as the exact origin, without path/query/trailing slash. Set `X_CALLBACK_URL` to that origin plus `/api/x/oauth/callback` and register the exact URL with X. Pass the X client credentials through the existing protected operator environment, never source control, issue text or chat. Current X documentation maps `/2/users/me` to `tweet.read users.read`; the app only requests identity, not posts.
3. Protect database access/backups: auth records include verified identity, CSRF and short-lived PKCE material. Use PostgreSQL for multiple workers. The `.auth.json` fallback is local-only, single-process, ignored by Git and unsuitable for a shared deployment.
4. Choose a release identifier for `FUNDED_BUILD_ID`. Build frontend/API together. The additive `auth_records`, `creator_directory` and `read_model_versions` schema is applied by the existing migration entrypoint. Allow a maintenance window for initial projection backfill; no production-scale migration timing has been measured.
5. The optional `compose.creator-devnet.yml` overlay explicitly disables development auto-wallet behavior and passes origin/OAuth/build configuration. It does not supply keeper/router authority secrets, approve payouts, change fee economics, or enable mainnet. The original preview Compose file does not wire every financial provider; leave those functions blocked until separately verified.

## Release sequence after target approval

Use the existing protected environment file with both Compose files. Validate with `docker compose -f compose.preview.yml -f compose.creator-devnet.yml config --quiet` so credentials are not printed. Take and verify a database backup in an approved protected location. Record the previous image tag and migration state for rollback before building/restarting the app. Do not delete volumes or use `down -v`.

After the approved deployment, run `verify:release-contract` with `FUNDED_RELEASE_BASE` set to the intended HTTPS origin, `FUNDED_EXPECT_BUILD` matching the chosen build identifier and `FUNDED_REQUIRE_POSTGRES=true`. It must report v3/Devnet and the expected build, assets and database-backed capabilities. Manually verify X login, same-origin cookies/CSRF, logout, cross-worker follow sync, opt-out, and social crawler rendering. Check proxy rate limits at the real ingress. Health checks only prove liveness; they do not prove any financial feature is ready. Compose configuration validation passed with dummy values; the Docker image itself was not rebuilt or deployed in this batch.

On rollback, retain the additive tables. Rolling back to the old app loses in-memory login state and the new security protections; keep creator writes/sign-in closed rather than silently serving an older unsafe flow. On database restore, invalidate all restored session/OAuth records before reopening sign-in so revoked sessions cannot be resurrected. Rebuild directory projections from restored authoritative launch/profile data if the backup versions differ. Any purge/restore is an operator-approved action, not performed by these instructions.

## Still not complete

Real X OAuth, confirmed Devnet launch/recovery/collection/payout including graduation, funding of community/buyback reserves, approved gift delivery/refunds, email/push, durable public metadata/origin guarantees, lifetime payout indexing, broad indexed read models, production load/restore drills, moderation staffing, independent security review, creator onboarding and retention experiments. Mainnet and virality are not validated. Native file picker and mobile wallet handoff still require end-to-end verification.

Security references: [OWASP OAuth browser binding](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html), [OWASP session lifecycle](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [X endpoint/scope mapping](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping).
