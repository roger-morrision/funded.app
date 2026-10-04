# Backend reliability verification — 2026-10-04

Scope: local backend code and disposable PostgreSQL 16. These checks do not certify
mainnet readiness, deployed services, external identity providers, or on-chain
settlement.

## Changes

- Chat challenges and sessions use private authentication storage, hashed opaque
  tokens, atomic consumption, network namespaces, expiry, and shared revocation.
  The schema migration explicitly permits the new chat namespaces. Local file
  auth operations serialize across store instances within one process; production
  still requires PostgreSQL.
- Chat mutations lock one mint and share the existing ledger coordination lock.
  Legacy whole-ledger writers remain mutually exclusive with scoped writes;
  unrelated chats may proceed concurrently. Rollback preserves previous messages.
- Request parsing accepts bounded JSON objects, rejects malformed/scalar/array
  bodies and unsupported content encoding, and times out incomplete uploads.
  Oversized uploads receive 413 instead of having their socket destroyed first.
- Unexpected errors return a generic 500 with a request ID. Explicit input
  validators preserve actionable 400 responses. Security headers and private API
  cache defaults apply before routing. Stable asset names revalidate; hashed build
  assets can be immutable.
- Price refreshes coalesce, successful quotes expire, provider failures back off,
  and expired quotes cannot be used for checkout.
- `/api/status` bounds database/RPC probes, verifies the configured genesis hash,
  and reports only storage/network availability. It explicitly does not verify
  settlement or authorize mainnet activation.
- Database connection, statement and idle-transaction timeouts bound waits. Idle
  pool connection errors have a sanitized handler. Rate budgeting rejects an
  oversized initial charge as well as subsequent charges.
- Verified creator receipts expose their recipient, source collection signature,
  obligation identifier, and response network to support auditable CSV exports.

## Reproduction

Run only against a disposable database: the PostgreSQL verification script drops
and recreates its schema. It enforces `BACKEND_DB_TEST=1`, hostname `127.0.0.1`,
port `15432`, and database `funded_test` before any destructive operation.

```sh
BACKEND_DB_TEST=1 DATABASE_URL=postgresql://postgres:local-test-only@127.0.0.1:15432/funded_test node scripts/verify-postgres-store.mjs
node --test tests/request-body.test.mjs tests/chat-session-store.test.mjs tests/http-policy.test.mjs tests/service-status.test.mjs tests/price-quote.test.mjs
node scripts/verify-token-chat.mjs
node scripts/verify-referral-server.mjs
node scripts/verify-creator-support.mjs
node scripts/verify-receipt-history.mjs
```

The PostgreSQL suite passed with concurrent chat appends, failed-mutation rollback,
chat/legacy ledger writer overlap, shared rate budgets, two-instance one-use chat
approval, network isolation and cross-instance revocation. Its existing migration,
scoped claim/profile, indexed search, receipt counts, retention, and backfill lease
checks also passed. The synthetic following read workload used 100 reads at
concurrency 10; observed p95 was 37.2 ms on one run. This is fixture evidence, not a
production capacity claim.

An explicit upgrade fixture restores the pre-chat auth CHECK constraint and seeds
all four legacy X/referral namespaces. It confirms chat writes fail before the
upgrade, runs two concurrent store migrations through the existing advisory lock,
then verifies legacy rows remain intact and all supported chat network namespaces
work. Unknown chat network namespaces remain rejected.

Local HTTP verification passed for chat authentication, reports, deletion and
moderation; referral signature verification with execution disabled; and creator
profile consent, opt-out, CSRF, rate limiting and persistence. Keys and fixture
receipts are synthetic. These HTTP suites do not execute financial transfers.
The 12 focused backend unit tests passed. Finalized receipt history also passed
its 29 synthetic payouts across three pages, exact entitlement joins, proof reuse,
payload invalidation, cursor/network guards, and HTTP privacy checks.

## Remaining operational evidence

Production needs independent contract/custody review, deployed network and program
identity checks, funded infrastructure and role configuration, durable storage and
restore drills, real identity-provider callback verification, device-wallet tests,
and finalized launch/trade/collection/payout evidence. File storage is a local
single-process fallback. The broader legacy ledger update path still exists;
this change scopes chat writes without rewriting financial transaction semantics.
