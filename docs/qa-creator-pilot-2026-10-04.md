# Creator-community pilot QA — 2026-10-04

## Scope and evidence limits

This pass verifies the local creator-pilot landing page, optional device measurement, and privacy controls. Browser API responses are mocked and remote hosts blocked in the development suite. Wallet callbacks and pilot signals are synthetic. No X posts or Solana transactions are submitted, and these records are not evidence of real participant adoption, retention, or financial outcomes.

The existing preview served HTTP 200 from build `8289dc11c50706021a26957601edc1bba34cc1a7` during development QA. A subsequent release upgrade is a separate step. The final container smoke script binds its evidence to an explicit expected build and records the browser source digest.

## Browser coverage

Four landing journeys cover the Home CTA and direct `/pilot` route; desktop and mobile layout; preparing a draft without interactive wallet connection; enrollment focus; explicit draft restoration without replacing unsaved edits; pending-launch receipt recovery; and invitation copy/fallback without enrollment or message sending.

Ten measurement journeys cover:

- Recording off by default, a required role, and explicit arrival-source selection.
- Actual JSON export containing only allowed event fields; sensitive details and unknown events are discarded, and no participant data is uploaded.
- Separate self-reported incentive and visit-prompt fields, captured per event and reset to unknown on reload.
- Cross-tab revocation without recreating deleted data.
- Storage failures during enrollment, event writes, export reads and deletion; stale in-memory data is not exported.
- Failed deletion reporting that data remains, with BroadcastChannel revocation tested in open Chromium tabs. The UI advises closing other tabs and clearing site data when persistence is unavailable; it does not promise deletion succeeded.
- Simultaneous distinct events retained under the shared browser lock, and simultaneous enrollment preserving one device record.

The development suite also retains the earlier launch-draft, navigation, wallet cancellation/network change, receipt, saved-search and public-trade-consent checks. Every tested page rejects uncaught browser errors.

## Model and performance boundaries

Backend model tests use synthetic cohorts to check mature D1/D7/D30 and weekly windows, missing follow-up, source/role/network separation and self-reported incentive classification. Missing observation coverage is unknown rather than churn. A local device record is not a unique person, and repeated enrollment does not establish new participants.

Live UI updates do not run the full cohort aggregation. Detailed analysis remains an explicit export/CLI operation. The root agent separately records the bounded synthetic aggregation benchmark; it is not a production load or real-user study.

## Reproduction

```sh
npm test
npm run check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --reporter=line
```

After deploying the exact release image to a loopback preview:

```sh
FUNDED_CONTAINER_BASE=http://127.0.0.1:8788 \
FUNDED_EXPECT_BUILD=<exact-source-revision> \
CHROMIUM_PATH=/usr/bin/chromium \
FUNDED_PILOT_EVIDENCE_DIR=/workspace/funded-delivery/pilot-smoke \
node scripts/verify-container-pilot.mjs
```

The container script uses actual local app/API responses and blocks remote browser hosts. It creates only disposable local records labeled as test sessions, verifies deletion, and closes the browser contexts. Read-only server RPC checks may occur; it performs no chain signing or X publication.

## Frozen-source results

The final local run passed **238/238 unit tests**, syntax checks for **470 JavaScript files**, and **40/40 Chromium browser tests in 2.9 minutes**. The browser total includes 26 existing journeys, 4 pilot landing journeys and 10 measurement/privacy journeys. All tested pages had zero uncaught browser errors. `git diff --check` also passed.

Logs are `/tmp/funded-pilot-final-unit.log`, `/tmp/funded-pilot-final-check.log`, and `/tmp/funded-pilot-final-browser.log`. An earlier browser run was intentionally stopped when the final performance/copy changes landed; it is not used as final evidence.

Exact-image container results and screenshots are written separately under `/workspace/funded-delivery/pilot-smoke/` after release verification. This document does not claim that a subsequent deployment has already passed.

## Production-route follow-up

The exact-image smoke on revision `71f9f7efe94fe897449268a4c9e95241a5aefb04` caught a production-only failure: `/pilot` returned HTTP 404 despite passing in Vite. Build identity and Devnet/PostgreSQL checks passed before that failure. The release agent rolled back to the prior healthy preview while preserving its database.

The correction adds explicit `/pilot` and `/pilot/` paths to the production SPA route policy. A real isolated API/static-serving test now requires the application shell for both paths and a query-string variant, while an unrecognized nested path still returns 404. The release contract now checks both pilot deep links against the deployed Home HTML. The focused route and static HTTP tests passed **2/2**; release-contract syntax and `git diff --check` passed. The earlier 238-unit/40-browser result remains evidence for the pilot implementation in `71f9f7e`; the follow-up server routing change has separate verification.

Hash-route screenshots from the rejected image remain under `/workspace/funded-delivery/pilot-smoke/hash-pilot-{1440,390}.png` for visual review. They do not turn the failed direct-route deployment into a passing release. The final direct-route container smoke must pass against the follow-up revision before acceptance.

The follow-up passed **239/239 unit tests**, **471 JavaScript syntax checks** and the isolated production HTTP contract including both pilot deep links. Browser source was unchanged; the earlier 40 browser journeys remain applicable, with exact-image pilot checks still required after redeployment.

The initial exact-branch CI also exposed an intermittent oversized-upload probe race in `verify-token-chat`: a full fetch upload could raise EPIPE when the server correctly rejected Content-Length early with HTTP 413 and closed the connection. The probe now sends headers first and requires the complete 413 JSON body, matching request ID and connection-close response. Network errors still fail. Streamed overflow remains covered separately. All six critical checks, the body-parser tests and three patched token-chat runs passed on Node 24.21.0. No production request-limit behavior was changed.
