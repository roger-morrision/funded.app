# Code structure and file-size limits

## Current audit — October 9, 2026

- All 941 maintained code and configuration files are at or below 1,000 lines. The largest is
  `index.html` at 855 lines; `server/index.mjs` is 486 lines. `app.js` is now 9 lines, reduced from 6,907
  before the controller/startup extraction. Its legacy size exception is gone.
- The browser runtime is organized into 46 controller factories and 40 ordered
  startup modules. All new runtime modules satisfy the tighter 500-line and
  40-KiB budgets. Source comparisons retained all 1,011 original imports and
  statements after normalizing explicit state access and rebased import paths.
- The size guard now includes YAML, TOML, Dockerfiles, and additional source
  extensions. Output exclusions are scoped so maintained folders such as
  `scripts/build` and `src/target` cannot silently escape the check. All six
  structure tests pass, including the new coverage regression.
- Page delivery now owns static assets, public token metadata, and social-preview
  HTML in `server/page-delivery.mjs`, reducing the server entry from 859 to 810
  lines. Public metadata lookup and later page fallbacks retain their dispatch
  positions; host restrictions and API authorization remain in the entry point.
- Thirteen page-delivery/share tests pass, covering traversal rejection, cache
  headers, unmatched routes, verified metadata fallbacks, HTML escaping, and
  private creator data exclusion. Isolated metadata HTTP verification, critical
  backend checks, and mainnet guards also pass. No live transactions were made.
- Fee-router configuration, readiness, payout, and collection helpers now belong
  to `server/fee-router-service.mjs`, reducing the entry point from 810 to 671
  lines. The service receives explicit environment, RPC, and sender dependencies;
  the production defaults retain the original behavior. All ten moved function
  bodies retain their syntax trees after replacing the environment reference.
- Twenty-four fee-service and claim/write-route tests pass with synthetic keys,
  mocked RPC data, and a fake transaction sender. Coverage includes wallet-role
  separation, approved program evidence, payout amounts, launch ownership,
  transaction balance proof, pending confirmations, and uncertain-send handling.
- Environment loading and scheduled maintenance now have dedicated modules,
  reducing the entry point from 671 to 625 lines. Environment precedence and
  skip behavior are unchanged. Initial share cleanup still completes before
  HTTP listen; claim indexing still starts afterward with the same delays.
- Twelve startup/structure tests pass, including configuration precedence,
  missing versus unreadable files, isolated cleanup mutations, failure recovery,
  and prevention of overlapping index jobs. Critical backend checks, isolated
  metadata HTTP verification, and mainnet guards also pass after this extraction.
- Referral activity and service-status routes now have separate factories,
  reducing the entry point from 625 to 561 lines (39,367 normalized bytes).
  Separate handler slots retain the original dispatch order. Shared request
  authorization remains in the entry point; wallet-scoped referral reads and
  authenticated receipt monitoring retain their route-specific checks.
- Fourteen focused tests pass after this extraction, covering response handling,
  receipt-monitoring access, unavailable quotes, per-instance status caching,
  network verification, share-visit privacy, and source structure. Referral
  privacy HTTP verification and the critical backend suite also pass.
- Chat validation now lives with its chat routes. Public trade-sharing setup and
  endpoints belong to `routes/public-trade-sharing.mjs`; launch previews and
  support records belong to `routes/launch-support.mjs`. This reduces the entry
  point from 561 to 486 lines and 34,077 normalized bytes, removing its size
  exception. Request gates and handler dispatch positions remain unchanged.
- Seventeen focused tests pass after these moves, including immutable review
  snapshots, invalid reward configuration, alert/intake validation, handler
  fallthrough, public-sharing origin checks, consent signatures, body limits,
  rate limits, and proof rejection. Critical backend and mainnet checks also
  pass; signed chat verification uses ephemeral keys and local HTTP fixtures.
- Syntax validation passed for 776 JavaScript files. The most recent full test suite
  finished with 560 passes, 2 skips, and 6 existing Windows maintenance-lock
  failures because the required external locking utility is unavailable.
- A further API cleanup reduced `server/index.mjs` from 956 to 859 lines by
  extracting discovery, launch quotes, and reward status. All eight moved route
  branches retain their original syntax trees. Shared request authorization and
  rate checks still run before dispatch, at the same route positions.
- Discovery pagination tests now import the actual route factory. Twenty-two
  focused route/service tests and the critical backend verification suite pass,
  covering verification concurrency, quote origin and expiry, unavailable prices,
  reward query validation, and removal of transaction payloads from receipts.
- Production build, wallet-state, mainnet-guard, and launch-wizard checks passed.
  Local browser checks passed for X rewards at 390/1440px, launch-package
  previews at 320/390/768/1440px, and Home rewards at desktop/mobile widths.
  Browser checks use mocked APIs and do not establish live transaction coverage.
- The token-detail verification script now reads its extracted activity, chart,
  and trade views. It still stops at a watch-button wording assertion that also
  fails against the pre-split source. That script is not reported as passing.
- The main browser chunk is approximately 709 kB (204 kB gzip); Vite's warning
  remains. This refactor enforces maintainable source boundaries, without a
  claim of reduced download size. Changes are local and have not been deployed.

## Implemented boundaries

`app.js` is a nine-line browser entry point. It creates an application context,
registers feature controllers, then runs ordered startup modules. Presentation
modules receive a fresh state snapshot
and explicit callbacks each time they render. They do not import `app.js`, own
wallet credentials, fetch data, or submit transactions.

### Browser application modules

- `src/app/dependencies.js` owns imports and preserves side-effect import order.
- `src/app/runtime.js` and `state-schema.js` own one private state context per
  application instance. Controllers receive it explicitly, so async operations
  read the current wallet and request revision after each await. It is never
  exposed on `window`. Constant bindings and initialization guards are retained.
- `src/app/controllers/` groups the existing handlers by feature: launch,
  Explore, trading, wallet sessions, rewards, analytics, and token details.
  Factories can be tested with injected state and dependencies without starting
  the browser application. `controllers.js` registers them before startup.
- `src/app/startup/` initializes state and registers listeners. `start.js` keeps
  the existing execution order and waits for wallet restoration before the
  later token-page initializers. Do not parallelize these calls.
- `scripts/read-app-source.mjs` supports older source assertions and VM fixtures
  by reading marked statements from the maintained modules. The browser never
  reconstructs or evaluates this text. Prefer importing controller factories
  directly for new behavioral tests.

| Location | Responsibility |
| --- | --- |
| `src/features/payments/receipt-view.js` | Receipt totals, recipient rows, fees, payment timestamps, expanded details |
| `src/features/analytics/dashboard-view.js` | Analytics cards and recent recipients |
| `src/features/home/kpi-view.js` | Home metrics and evidence states |
| `src/features/home/launch-card-view.js` | Shared launch cards, fee route labels, volume formatting, promotion decoration |
| `src/features/home/launch-board-view.js` | Home ticker, verified launch filters, paused ordering, and grid/table rendering |
| `src/features/trade/amount-view.js` | Trade balance, estimate, buy/sell labels, and round-trip share visibility |
| `src/features/launch/preview-view.js` | Launch package and X post previews, identity, fee allocation, and developer-buy summaries |
| `src/features/launch/form-validation.js` | Metadata preview, identity/reward validation, and pre-signing readiness |
| `src/features/launch/action-view.js` | Launch action, wizard navigation, identity warnings, and review confirmation state |
| `src/features/launch/cost-view.js` | SOL cost summary, promotion burn display, and expandable estimate details |
| `src/features/home/program-picker.js` | Program picker events and shared preview rendering |
| `src/features/coin/chart-view.js` | Price / market-cap chart and currency states |
| `src/features/coin/activity-view.js` | Trade, holder, collection, and allocation tables |
| `src/features/coin/pulse-view.js` | Trade-period totals and partial-history states |
| `src/features/coin/header-view.js` | Accessible social controls and token summary metrics |
| `src/features/coin/holder-distribution-view.js` | Reconciled holder balances and distribution |
| `src/features/fees/fee-flow-view.js` | Published policy and fee calculator |
| `src/features/shared/display.js` | Shared formatting, escaping, and small DOM helpers |
| `src/features/portfolio/` | Holdings, creator launches, and wallet detail rendering |
| `src/features/funded/` | $FUNDED landing page and buyback receipt views |
| `src/features/rewards/airdrop-view.js` | Airdrop details, eligibility states, and analytics |
| `src/features/rewards/x-claim-view.js` | X reward totals, claim steps, destination confirmation, and status copy |
| `src/features/rewards/x-claim-controller.js` | X identity loading, reward selection, and session-guarded SOL claims |
| `src/features/rewards/*cards-view.js`, `card-format.js` | Home SOL and token airdrop cards and shared reward formatting |
| `src/features/wallet/mobile-controller.js` | Phantom mobile relay, QR cancellation, signed-session restore, and provider adapters |
| `src/features/jackpot/` | Device alert lifecycle and verified round eligibility helpers |
| `src/features/explore/` | Filter controls, benefit leaders, payout metrics, and asset rendering |
| `src/features/explore/status-view.js` | Launch stage counts and filter-specific empty states |
| `src/features/explore/registry-view.js` | Explore table rows, pagination, and loading/empty/unavailable states |
| `src/features/home/holder-rewards-view.js` | Verified holder reward coin list and policy availability |
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
| `server/routes/discovery.mjs` | Pump and Birdeye discovery, pagination, and bounded launch verification |
| `server/routes/launch-quotes.mjs` | Launch quote origin checks, pricing, payer binding, expiry, and persistence |
| `server/routes/reward-status.mjs` | Automatic reward availability, sanitized buyback receipts, jackpot preview, and reward proof queries |
| `server/page-delivery.mjs` | Static file delivery, public metadata/images, and token/creator social-preview pages |
| `server/fee-router-service.mjs` | Fee-router configuration and readiness, dedicated payout wallet checks, collection, and transaction proof interpretation |
| `server/environment.mjs` | Environment, secret-file, and local-file precedence during startup |
| `server/background-maintenance.mjs` | Initial and recurring share cleanup, scheduled community claim indexing |
| `server/routes/referral-activity.mjs` | Opt-in share visits, wallet-scoped claim lists, and referral dashboard metrics |
| `server/routes/service-status.mjs` | Service health, SOL quotes, readiness, protected receipt monitoring, and keeper status |
| `server/routes/public-trade-sharing.mjs` | Public sharing configuration, proof verifier setup, consent and challenge endpoints |
| `server/routes/launch-support.mjs` | Reward/risk previews, immutable launch reviews, alerts, and X launch intake |
| `server/routes/launch-registration.mjs` | Signed launch policy, router proof, community reserve verification, and reward registration |
| `server/routes/listing-payments.mjs` | Burn receipt attribution and paid listing verification with replay protection |
| `server/routes/keeper-collection.mjs` | Authorized indexing, fee collection locks, and wrapped SOL reconciliation |
| `server/routes/settlement.mjs` | Evidence-derived fee allocation and automatic reward queue handoff |
| `server/routes/x-identity.mjs` | X OAuth, sessions, account lookup, and reward readiness |
| `server/routes/creator-fees.mjs` | Creator fee activity, claim preparation, and signed claim requests |
| `server/routes/referral-claims.mjs` | Referral claim challenges, wallet verification, execution locks, and receipt replay |
| `server/routes/sol-claims.mjs` | X reward obligations, wallet binding, attestation, and SOL claim execution |
| `server/rpc-proxy.mjs` | Solana RPC validation, budgets, per-instance cache, and concurrency limits |
| `server/market-providers.mjs` | Birdeye/Pump requests and token response normalization |
| `server/launch-tier-pricing.mjs` | Verified pool pricing, quote freshness, and per-instance price cache |
| `server/settlement-rewards.mjs` | Holder registration, immutable settlement funding requests, and verified X reward enrollment |
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
Every maintained code file has a hard maximum of **1,000 lines**, including
scripts, tests, contracts, YAML/TOML configuration, Dockerfiles, and future source directories.
Dependencies, generated builds, temporary evidence, and vendored distributions
are excluded. New runtime files are limited to **500 lines and 40 KiB**. Both are checked so
compressing a large file into long lines does not evade the limit. Line endings
are normalized for consistent Windows and Linux results.

`config/source-size-baseline.json` records the remaining oversized legacy files.
Only `index.html` (855 lines) retains an exception to the tighter runtime budget.
No exception may exceed 1,000 lines. Its ceiling allows this migration to be
incremental; it must not grow beyond its existing ceiling. Reduce the ceiling
after an extraction. Do not raise it to
pass a check. Split cohesive responsibilities rather than arbitrary line ranges.

## Remaining migration priorities

| File | Next boundary to extract |
| --- | --- |
| `src/app/controllers/` | Gradually narrow each controller's injected dependencies and migrate legacy source fixtures to direct module tests |
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
- `scripts/read-app-source.mjs` follows the extracted application modules for
  legacy source checks. Direct controller tests exercise live wallet changes,
  isolated instances, and state changes while an RPC request is pending.
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

## Launch form and status views — October 9, 2026

- Extracted 14 synchronous functions into six feature modules, each below 200
  lines. `app.js` shrank from 7,538 to 7,228 lines (537,881 to 515,229 normalized
  bytes). Its size ceiling was reduced accordingly.
- The composition layer supplies current state and callbacks on every call.
  Wallet signing, request lifecycles, and state updates remain in the controller.
- All 14 extracted function bodies match the original syntax trees. Removed
  imports that became unused in the composition layer.
- Forty-four focused tests pass. New coverage exercises connection/refresh/review
  actions, expiry and consent changes, invalid form inputs, developer-buy limits,
  empty Explore states, social-link accessibility, and holder policy filtering.
- The launch wizard check now reads the owning modules and imports the actual
  cost renderer instead of evaluating copied source text.
- Source/size checks, production build, and launch package browser regression
  pass. Browser coverage uses mocked APIs at 320, 390, 768, and 1440px; it does
  not sign transactions or establish live payout coverage.
- Remaining oversized files are `app.js`, `server/index.mjs`, and `index.html`.

## Home and Explore views — October 9, 2026

- Moved the Home launch board and Explore table into 166-line and 106-line
  modules. `app.js` shrank from 7,047 to 6,907 lines (500,665 to 484,667
  normalized bytes). Its size ceiling was reduced and moved imports removed.
- The registry wrapper refreshes launches before creating the render snapshot.
  Explicit accessors keep pagination, filter criteria, and frozen Home ordering
  owned by the application, including state changes before early returns.
- Both render bodies retain their original syntax trees with those explicit
  state accesses. Rendering, filtering, and escaping behavior are preserved.
- Eighteen focused tests pass. New coverage includes old zero-volume launches,
  verified-policy filtering, paused/resumed ordering, table metadata escaping,
  pagination resets and clamping, and distinct loading/outage/empty states.
- Source/size checks, production build, and the existing Home rewards browser
  regression pass. Browser verification uses read-only fixtures and covers
  desktop/mobile reward rendering, countdowns, and scrolling; no transactions.
- The proof-UI and discovery source checks now read the owning view modules.
  Their previously documented unrelated stale assertions remain; these entire
  scripts are not claimed as passing.
- `app.js`, `server/index.mjs`, and `index.html` remain oversized. The browser
  bundle-size warning also remains; this pass improves source organization.
  Next boundaries are async domain controllers and HTML page templates. Moving
  async controllers must preserve cancellation checks and current wallet state
  after each awaited operation. The browser bundle warning remains.

## Claim route extraction — October 9, 2026

- Extracted four route families from `server/index.mjs`, reducing it from 1,484
  to 1,159 lines (118,748 to 85,540 normalized bytes). Reduced its size ceiling.
  Each new module stays within the 500-line / 40-KiB runtime limit.
- All 28 moved route statements match their original syntax trees, except the
  handled-response signal for authorization denials and OAuth redirects. Shared
  request gates and handler order remain in the composition layer.
- Fifty-four focused tests pass, including ten new checks for route dispatch,
  private reads, original X identity, wallet signatures, concurrent referral
  execution, uncertain transfers, paid replay, and creator-claim network guards.
- Isolated X OAuth and referral HTTP checks pass with a mocked X provider and
  ephemeral keys. Scoped claim and referral state checks cover concurrency,
  rollback, stale signatures, and immutable receipts. No transfers were made.
- Source/size checks, mainnet guards, critical verification, and production build
  pass. The existing browser chunk-size warning remains. These results are local
  verification and do not establish live payout coverage.
- Remaining oversized files: `app.js`, `server/index.mjs`, and `index.html`.
  Continue with cohesive controllers, shared server services, and page templates;
  do not split files solely by line count.

## Server services — October 9, 2026

- Extracted ten service functions into four modules. `server/index.mjs` shrank
  from 1,159 to 956 lines (85,540 to 71,940 normalized bytes); its size ceiling
  was reduced. Existing local view and route extractions were retained.
- RPC and launch-price caches now belong to their service instances. Factories
  are created once before dependent route handlers. Provider calls accept an
  injected fetch function for isolated tests; production still uses global fetch.
- All ten moved function bodies match their original syntax trees. Shared
  authorization, rate policy, handler order, and reward accounting are preserved.
- Forty-three focused tests pass, including eleven new service tests for cache
  isolation, RPC failure recovery, provider credential scope, pricing expiry,
  settlement conflicts, and X recipient binding. The signature-limit tests now
  import the actual proxy factory instead of evaluating source text.
- Source/size checks, mainnet guards, critical verification, and the production
  build pass. Tests use synthetic
  provider responses and isolated stores; no on-chain transfer was performed.
- The existing browser bundle-size warning remains. `app.js`, `server/index.mjs`,
  and `index.html` still have shrinking legacy file-size exceptions.

## X rewards browser modules — October 9, 2026

- Extracted seven functions into a 90-line view module and a 174-line controller.
  `app.js` shrank from 7,228 to 7,047 lines (515,229 to 500,665 normalized bytes).
  Reduced the size ceiling and removed imports owned by the extracted modules.
- The application retains wallet ownership and event wiring. The claim controller
  reads the wallet through a live getter before and after connection; its original
  session guards still follow asynchronous identity, preparation, attestation,
  signing, verification, execution, and receipt reads.
- All seven moved bodies retain their syntax trees except the explicit live
  wallet getter. Fifty-three focused tests pass, including 27 wallet-session
  cases. The session tests import the actual controller instead of evaluating
  copied claim source; session guard helpers still come from the application.
- Source/size checks and the production build pass. The existing browser chunk
  warning remains; extracting modules does not by itself reduce download size.
- `scripts/verify-x-claim-ui.mjs` passes against the built rewards UI with mocked APIs
  at 390px and 1440px. It checks totals, row order, selection, wallet gating,
  sign-out, and paid/empty/unavailable states without signing or submitting claims.
- `verify-proof-ui.mjs` reads the new view module for the status-copy assertion.
  Its previously documented unrelated stale-label failure remains outside this
  refactor; the entire proof-UI script is not claimed as passing.
- Remaining oversized files are `app.js`, `server/index.mjs`, and `index.html`.
