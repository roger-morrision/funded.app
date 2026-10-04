# X posting and return-visit QA — 2026-10-04

This pass uses synthetic X responses, a disposable PostgreSQL 17 database, and local Chromium. It does not publish to X, create Solana transactions, or establish live account permissions.

## Browser verification

`CHROMIUM_PATH=/usr/bin/chromium npx playwright test --reporter=line` passed all **26 tests** (20 application journeys and 6 isolated consent-module journeys). API responses are intercepted and external HTTPS requests are blocked. Each tested page rejects uncaught browser errors.

The four added journeys verify that guide dismissal/reopening persists on mobile without network writes; resuming a draft focuses explicit Restore without replacing unsaved input; undoing a saved-search deletion preserves active filters; and a real second browser tab updates saved choices without overwriting the first tab's input. Existing draft, wallet cancellation/network changes, navigation, retry, service status, receipt and clipboard flows still pass. The six consent-module cases cover unchecked explicit approval, retrying with the same message signature, wallet changes during signing, closing the dialog, mismatched network previews, wallet cancellation, and disabled publication capability. These cases mount the actual UI module with mocked API responses and wallet callbacks; they do not sign real wallet messages.

## Durable outbox verification

Run the integration harness only against a disposable database:

```sh
X_POST_DB_TEST=1 \
X_POST_TEST_DATABASE_URL=postgresql://funded:isolated-x-qa-only@127.0.0.1:15433/funded_x_test \
node scripts/verify-x-post-outbox.mjs
```

The harness rejects other hosts, ports, and database names before resetting its test schema. It uses actual SQL transactions and independent store instances, with synthetic HTTP responses supplied through the production client's explicit fetch injection. No real credentials are used.

**11 check groups passed:** concurrent immutable deduplication; one dispatch across racing workers; durable pacing and token fencing; ambiguous sending-lease expiry without replay; persisted bounded retries; isolated account namespaces; permanent versus uncertain worker outcomes; zero-publish draft/disabled workers; hourly and daily account caps; case-insensitive account limits; and atomic collector checkpoints with full rollback on immutable conflicts. The client-to-worker integration additionally covers successful posting, 429, 403, 503, malformed success, missing publication IDs and connection resets, without duplicate sends.

During these QA checks, the existing workspace app and its database were not changed. Draft checks and mock client responses are not evidence of X publishing permission or public Devnet financial execution. Full daily summaries and profit posts still depend on verified source coverage and explicit sharing consent; missing evidence must remain unpublished.

## Collector and CLI integration

With the same isolated database environment, `node scripts/verify-x-post-cycle.mjs` passed **3 checks**: all five event kinds traverse collection, formatting and SQL enqueue, retaining exact SOL units; a second draft cycle produces no duplicate events; and the main-state public trade consent bucket survives closing and reopening its PostgreSQL store. Verified evidence providers in this harness are synthetic. It caught and fixed inconsistent event-kind spelling between modules.

`node scripts/verify-x-post-draft.mjs` passed **2 checks** using actual CLI subprocesses and an eligible source launch. A preload trap blocks every outbound HTTP request: default draft mode attempts only read-only Devnet verification and makes **zero X requests**; status mode makes **zero outbound HTTP requests**. Draft mode in normal operation may read Devnet RPC to verify evidence. No requests leave the harness.

`node --test tests/x-post-cli.test.mjs` passed **4 tests** for default draft behavior, explicit publication gates, configuration validation, and rejecting a queued wrong-network event before invoking the publisher. During QA, the existing workspace app served HTTP 200 from build `9d626b6bb81257d40f670ae5cbf8c43f23ef56a7` and was not stopped or upgraded. Any subsequent release upgrade is a separate deployment step.

The **3 client unit tests** additionally verify fixed HTTPS endpoints and rejected redirects, account ID/handle checks that revoke previous approval when reverification fails, and sanitized errors that do not expose provider bodies or access tokens.

## Final local checks

After the product changes froze, `npm test` passed **219/219 tests**, and `npm run check` syntax-checked **461 JavaScript files**. The three isolated PostgreSQL harnesses passed again in sequence: **11 outbox**, **3 collector-cycle**, and **2 CLI draft/status** check groups. Browser results are reported separately from chain execution; no X posts or on-chain transactions were created by this QA pass.

The final Chromium run passed **26/26 in 1.9 minutes**, with no uncaught browser errors. The isolated PostgreSQL test container was removed after verification; the existing workspace app and database were healthy and running when these QA checks ended.
