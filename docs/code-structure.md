# Code structure and file-size limits

## Implemented boundaries

`app.js` still contains legacy controllers and acts as the browser composition
layer, owning mutable wallet, launch, market, and receipt state. Presentation
modules receive a fresh state snapshot
and explicit callbacks each time they render. They do not import `app.js`, own
wallet credentials, fetch data, or submit transactions.

| Location | Responsibility |
| --- | --- |
| `src/features/payments/receipt-view.js` | Receipt totals, recipient rows, fees, payment timestamps, expanded details |
| `src/features/analytics/dashboard-view.js` | Analytics cards and recent recipients |
| `src/features/home/kpi-view.js` | Home metrics and evidence states |
| `src/features/home/launch-card-view.js` | Shared launch cards, fee route labels, volume formatting, promotion decoration |
| `src/features/trade/amount-view.js` | Trade balance, estimate, buy/sell labels, and round-trip share visibility |
| `src/features/launch/preview-view.js` | Launch package and X post previews, identity, fee allocation, and developer-buy summaries |
| `src/features/home/program-picker.js` | Program picker events and shared preview rendering |
| `src/features/coin/chart-view.js` | Price / market-cap chart and currency states |
| `src/features/coin/activity-view.js` | Trade, holder, collection, and allocation tables |
| `src/features/coin/pulse-view.js` | Trade-period totals and partial-history states |
| `src/features/coin/holder-distribution-view.js` | Reconciled holder balances and distribution |
| `src/features/fees/fee-flow-view.js` | Published policy and fee calculator |
| `src/features/shared/display.js` | Shared formatting, escaping, and small DOM helpers |
| `src/features/portfolio/` | Holdings, creator launches, and wallet detail rendering |
| `src/features/funded/` | $FUNDED landing page and buyback receipt views |
| `src/features/rewards/airdrop-view.js` | Airdrop details, eligibility states, and analytics |
| `src/features/rewards/*cards-view.js`, `card-format.js` | Home SOL and token airdrop cards and shared reward formatting |
| `src/features/wallet/mobile-controller.js` | Phantom mobile relay, QR cancellation, signed-session restore, and provider adapters |
| `src/features/jackpot/` | Device alert lifecycle and verified round eligibility helpers |
| `src/features/explore/` | Filter controls, benefit leaders, payout metrics, and asset rendering |
| `src/features/coin/promotion-view.js` | Verified promotion badges and reward policy shares |
| `src/features/home/onchain-view.js` | Home market snapshot and evidence reporting |
| `src/features/leaderboard/board-view.js` | Wallet, project, and launch rankings |
| `src/features/launch/burn-selection-view.js` | Launch package selection and burn readiness display |
| `src/features/workspace/` | Navigation, page composition, accessible tabs, and disclosure helpers |
| `styles/experience/` | Page layouts and controls, split into 16 sections |
| `styles/pages/` | Page theme refinements, split into 14 sections |
| `styles/base/` | Shared UI, launch, discovery, and accessibility styles in 17 sections |
| `styles/coin/` | Token page panels, activity, trade review, and responsive layouts in 7 sections |
| `styles/home/` | Home navigation, discovery, cards, metrics, and responsive styles in 5 sections |
| `server/routes/boost.mjs` | Boost offers, quotes, and verified payment receipts |
| `server/routes/airdrops.mjs` | Community reserves, proofs, and claim instructions |
| `server/routes/token-chat.mjs` | Wallet sessions, discussion, reports, and moderation |
| `server/routes/referral-identity.mjs` | Referral authentication, profiles, and share links |
| `server/routes/public-reports.mjs` | Sanitized state, receipt history, and analytics summaries |
| `server/routes/directory.mjs` | Launch pagination, creator profiles, listings, and burn leaderboards |
| `server/routes/quote-assets.mjs` | Verified quote asset catalog and its own cache |
| `server/routes/token-market.mjs` | Token accounts and trade history with per-router caches, concurrency, and rate limits |
| `server/routes/launch-registration.mjs` | Signed launch policy, router proof, community reserve verification, and reward registration |
| `server/routes/listing-payments.mjs` | Burn receipt attribution and paid listing verification with replay protection |
| `server/routes/keeper-collection.mjs` | Authorized indexing, fee collection locks, and wrapped SOL reconciliation |
| `server/routes/settlement.mjs` | Evidence-derived fee allocation and automatic reward queue handoff |
| `server/postgres/` | Ledger migration/projections and domain repositories for claims, receipts, creators, accounts, and assets |

The root `page-experience.css`, `ansem-pages.css`, `styles.css`, `coin-detail.css`,
and `home-reference.css` files are ordered import manifests. Preserve import
order: these sheets contain cascade refinements.
The extraction preserved every rule and declaration in order; relative artwork
URLs were rebased to their original assets. Vite bundles the imports for release.
This is a source organization change, not a claim of smaller download size.

`workspace-ui.js` now only initializes page composition and synchronizes routes.
Its feature modules move existing DOM nodes, preserving IDs and listeners.
Keep initializer order: reward and token layouts depend on earlier page setup.
View modules receive environment labels through explicit inputs instead of
importing browser configuration, so they can be tested without a Vite runtime.

`server/index.mjs` remains the API composition layer. Route factories receive
explicit dependencies and return `true` after responding or `false` when a
request does not match. They run at their original positions after the shared
request policy and rate limits. Protected reads retain their authorization
checks; denied requests must stop dispatch. Airdrop routes also expose
`invalidateReserveCache`, called when launch registration changes reserve data.
Keep this invalidation in addition to funding and drop-opening invalidation.

`server/postgres-store.mjs` creates one pool and readiness gate, then composes the
domain repositories. Each repository receives that same pool and gate. An
operation retains its entire transaction, locks, mutation checks, projection
writes, rollback, and connection release. Do not split a financial transaction
across repositories or initialize a separate pool for each domain.

`automatic-rewards-ui.js` owns refresh revisions, timers, and current reward data;
its card views receive fresh values at render time. The mobile wallet controller
owns QR request revisions and relay state, while `app.js` still owns the active
wallet. The controller reads the current wallet through a getter. A relay result
is rejected if the request was cancelled while the poll was in flight.

## Size policy

Run `npm run check:structure`, also included in `npm run check` and therefore CI.
New runtime files are limited to **500 lines and 40 KiB**. Both are checked so
compressing a large file into long lines does not evade the limit. Line endings
are normalized for consistent Windows and Linux results.

`config/source-size-baseline.json` records the remaining oversized legacy files.
Their ceilings allow this migration to be incremental; they must not grow beyond
their existing ceiling. Reduce a ceiling after an extraction. Do not raise it to
pass a check. Split cohesive responsibilities rather than arbitrary line ranges.

## Remaining migration priorities

| File | Next boundary to extract |
| --- | --- |
| `app.js` | Explore controller, launch controller, wallet session coordinator, reward controllers |
| `server/index.mjs` | Remaining launch registration, market, X reward, and settlement routes |
| `index.html` | Page templates with stable IDs and accessible relationships |

Do not move transaction state into display modules or introduce a shared global
context to hide dependencies. Keep existing financial validation gates and
wallet-change checks intact when extracting controllers.

## Verification and release tracking

- `scripts/check-source.mjs` recursively checks `src/`, as well as server,
  scripts, tests, and browser root entry points.
- `scripts/browser-source-digest.mjs` includes nested `src/` and `styles/` files,
  so changing or removing an extracted module changes the release fingerprint.
- `scripts/read-stylesheet.mjs` expands local imports in source-based UI checks
  while preserving order and rejecting circular imports.
- Chart and receipt tests import the actual view modules instead of extracting
  function text from `app.js`.
- Route contract tests cover unmatched requests, authorization termination,
  rate limits, input validation, and private session response headers.
- Feature view tests cover wallet changes, current quotes, missing-price states,
  escaped metadata, focused controls during refresh, airdrop lifecycle states,
  and keyboard navigation around unavailable tabs.
- Repository tests use a recording database adapter to check transaction ordering,
  rollback, lock placement, canonical payouts, chat delegation, and schema path
  resolution. These are mocked orchestration checks, not live PostgreSQL tests.
- Mobile controller tests use ephemeral in-memory keys and mocked relay responses
  for session proofs, message/transaction signatures, expiry, and late cancellation.

## Refactor verification — October 8, 2026

- `app.js`: 9,794 → 7,898 lines; 731,838 → 568,717 normalized UTF-8 bytes.
- `automatic-rewards-ui.js`: 540 → 319 lines; 38,058 → 21,817 normalized UTF-8 bytes.
- `server/postgres-store.mjs`: 588 → 49 lines; 41,522 → 3,039 normalized UTF-8 bytes.
  All 44 store method bodies and nine helper bodies were compared against their
  original syntax trees. The six domain files are 37–210 lines each.
- `workspace-ui.js`: 901 → 65 lines; 66,257 → 4,251 normalized UTF-8 bytes.
- `page-experience.css`: 2,639 → 17 lines in its entry manifest.
- `ansem-pages.css`: 727 → 15 lines in its entry manifest.
- `styles.css`: 689 → 18 lines; `coin-detail.css`: 826 → 8 lines;
  `home-reference.css`: 526 → 6 lines in their entry manifests.
- `server/index.mjs`: 2,366 → 1,957 lines, with four route families extracted.
- Build, source checks, critical verification suite, launch wizard checks, and
  focused chart/receipt/structure tests pass.
- Local browser verification with existing public data: Home metrics, Rewards
  history and expanded fee details, token chart states, holder balances, fee
  collections, and allocations. No wallet signing or new transactions.
- Additional local checks after the workspace split: disconnected Portfolio and
  Created tokens tabs, Rewards and $FUNDED allocations, airdrop detail expansion,
  Explore sorting and Following, token promotion and fee-share labels, wallet
  launch history, and launch form composition. No console errors were captured.
  Missing live trade and reserve evidence remained unavailable; these checks
  confirm rendering and navigation, not payout or transaction execution.
- All 29 function bodies moved in the second extraction were compared against
  their original syntax trees, excluding the explicit DOM dependency binding.
- The full Windows test run after the initial third-pass tests: 479 passed, six unrelated maintenance-lock failures
  because the Linux `flock` executable is unavailable, and two skipped tests.
- On October 8, the PostgreSQL integration suite was blocked by Docker access.
  No production database was used for refactor verification.
- On October 8, the older `verify:home-rewards-ui` script assumed cards were immediately visible
  on Home. The current product layout wraps them in a closed Community rewards
  disclosure, so that script stops at its visibility assertion. It was not weakened.
- A separate local browser smoke check opened that disclosure at 1440px and 390px,
  then verified token/SOL amounts, claimed/unclaimed values, card counts, and the X
  recipient link with deterministic API fixtures. Both widths had zero page errors.
  The 14 focused repository/mobile-controller tests pass, as does `verify:wallet-state`.
- `verify:proof-ui` still stops at its pre-existing assertion for the removed
  “Community airdrop allocations” HTML label. The HTML is unchanged in this refactor.
- `verify:airdrop-policy` and `verify:explore-discovery` contain stale source-copy
  assertions for claim coverage and analytics wording. The same failures were
  reproduced against the pre-refactor HEAD sources; their assertions were not weakened.
- The existing Vite warning about a browser chunk exceeding 500 kB remains.

## Release verification — October 9, 2026

- Retained the deployed `1a2eb44` Home rewards disclosure/layout fix before
  publishing the refactor, including its updated browser regression test.
- `jackpot-ui.js`: 544 → 464 lines, with alerts and round eligibility extracted.
  Its legacy size exemption was removed. The remaining oversized files are
  `app.js`, `server/index.mjs`, and `index.html`.
- Source checks, size budgets, build, and the critical verification suite passed.
- All 17 focused wallet, repository, and jackpot tests passed.
- The isolated PostgreSQL suite passed on `127.0.0.1:15432/funded_test`, including
  keyed reads, concurrent scoped claims/profiles, migrations, rollback, receipt
  counts, retention, and leased backfill. The live application database was not used.
- `verify:home-rewards-ui` passed with the retained disclosure fix: token amounts,
  logos, evidence states, countdowns, overflow motion, and mobile scrolling.
- Docker dependency pruning restores the exact pre-build lockfile after the
  offline prune, preventing a source fingerprint mismatch while retaining locked
  dependency resolution. Disabling lockfile use forces uncached registry lookups.

## Further extraction — October 9, 2026

- Moved 12 presentation functions into five feature modules; `app.js` shrank
  from 7,898 to 7,538 lines (568,717 to 537,881 normalized bytes).
- Moved four public data route families out of `server/index.mjs`, reducing it
  from 1,957 to 1,797 lines (158,098 to 145,236 normalized bytes).
- Market and quote caches live in their route factories, retain the same lifetime
  across requests, and are isolated between independently constructed routers.
  Shared policy, authorization, and rate gates remain in their original order.
- All 12 moved view bodies and 23 moved route statements were compared against
  the previous release syntax trees and are unchanged.
- Nineteen focused tests pass, including pagination validation, public-state
  sanitization, market cache isolation, stale market evidence, wallet changes,
  fee/slippage balance warnings, and receipt-gated sharing. These are mocked
  contract checks; they do not execute transactions.
- Source/size checks, the launch wizard check, build, and critical suite pass.
  The launch wizard now checks preview assertions in the actual feature module.
- The three legacy file exceptions and the existing browser bundle-size warning
  remain; further controller and HTML template extraction is still needed.
- The launch package browser regression passes at 320, 390, 768, and 1440px with mocked APIs, using the current description and preview disclosures and two-step form.

## Write route extraction — October 9, 2026

- Extracted four write route families; the server entry file shrank from 1,797
  to 1,484 lines (145,236 to 118,748 normalized bytes).
- Kept transaction locks, immutable policy checks, receipt attribution, and
  post-write reward handoffs together inside their owning route modules.
- All nine moved route statements match their original syntax trees, except
  authorization denials now return the dispatcher handled signal after responding.
- All 26 focused module tests pass, including blocked replay after an uncertain
  collection, burn/listing receipt attribution, launch gates, evidence-derived
  settlement amounts, queue failure recovery, and settlement replay.
- The isolated referral HTTP integration passes with ephemeral keys and disabled
  payout execution. The critical verification suite and source size checks pass.
- These checks do not execute on-chain transactions. The three legacy size
  exceptions remain; new runtime modules retain the 500-line / 40-KiB limit.
