# AI marketing agency policy

Product workflows: [all-page guide](product-guide.md). Documentation scope and dated evidence: [index](README.md).

Historical integration and activation checkpoint reports have been retired. The
rules and activation requirements below remain the maintained reference.
Configuration alone does not prove posting, billing or buybacks.

## Approved rules

The published allocation applies to new launches. Only the 8% Operations & marketing category is the app allocation; the other 92% is allocated to creators and ecosystem benefits. Policy publication is separate from executor activation. Existing mint policies and historical allocations retain their signed rates.

| Gross collected creator fees | Allocation |
| --- | --- |
| Creator-directed | 80% |
| Operations & marketing | 8% |
| Referrals | 1%: L1 0.6%, L2 0.25%, L3 0.15% |
| AI marketing agency | 2% |
| Daily bonus | 4% |
| Existing $RICH buyback | 5% |

Every new launch includes both buyback agents. Agent 1 (X promotion) is included only when a promotion package is selected. The agency budget is split equally across the included agents, using cumulative integer rounding. Existing coins keep their saved selections; unused budgets remain reserved. This does not restore the historical 3% referral share. The existing $RICH buyback budget is separate.

1. Agent 1 promotes the launched project through the richpad.fun X account at most once per coin per 24 hours. Its accumulated agency share is billed only after the post is independently verified. A verified but unbilled post blocks another post until billing is reconciled. The next durable sequence becomes eligible 24 hours after verified delivery; an uncertain intent is reconciled rather than retried as a fresh promotion.
2. Agent 2 buys and burns that same coin once at verified USD market cap >= $100,000.
3. Agent 3 buys and burns that same coin once at verified USD market cap >= $300,000.

Each milestone can spend only its own accumulated agency budget. Later allocations remain reserved after a one-time action. A missing quote, incomplete market data, insufficient spendable funds, uncertain submission, or missing proof does not count as execution.

Agent 1 additionally shares the account's conservative limit of four X posts per UTC day, at least six hours apart, with reviewed daily payout summaries and all other posts. The per-coin 24-hour cadence is eligibility, not a promise of daily publication. Queued promotions are not billed. Every promotion requires an admin review of the exact immutable content, expiring after 24 hours. Both publishers remain stopped during the account suspension; approval cannot resume them. Exact and substantially similar posted/uncertain text within seven days is held, including another daily promotion whose text has not changed; it needs reviewed, genuinely new content before a later delivery. Account-access failures retain the intent and wait six hours. See [X worker policy](x-event-worker.md) for the operational limits; they cannot guarantee that X will not restrict an account.

## Current source behavior

- Dedicated `#marketing-agency` navigation and responsive page.
- Launch promotion team selection preview with equal-share explanation.
- Candidate configuration, exact cumulative allocation projection, deterministic one-time intent IDs, and trigger decision evaluator.
- Read-only `/api/marketing-agency` exposes unavailable financials and explicit activation blockers.
- Launch preparation and registration require the reviewed program, published configuration and current readiness gates. An unavailable route stops before signing or registration; selected agents alone do not establish readiness.
- Unit tests cover conservation, all selection subsets, u64 amounts, threshold boundaries, stale/wrong network/wrong mint observations, and repeated/uncertain intents. Browser fixtures cover desktop/mobile routing, team selection, unavailable financials, and retry.

## Publication, readiness and execution

The source includes the eight-category policy, saved per-mint agent budgets,
durable buyback workers, transaction journaling, proof verification and separate
X promotion/billing. See [automation](onchain-automation.md) and
[configurable rules](configurable-financial-rules.md). These are implemented
paths, not evidence that every route is enabled in a particular deployment.

The AI Marketing page and coin detail report saved selection, protected funding,
saved thresholds, worker readiness and recorded finalized history separately.
An old receipt can remain visible while current execution is unavailable.
Default own-coin thresholds are $100,000 / $300,000 and default promotion cadence
is 24 hours; authority-signed future-launch rules can change them. Existing
coins keep their own saved terms. Publication does not prove a live market-cap
crossing, a funded budget, an X post or a burn.

## Historical October 19–20 activation checklist

The following checklist records the initial implementation boundary. It is not
a current inventory of missing code or a current deployment status. Recheck the
actual runtime and receipts for acceptance of any later release.

Historical V3 launches keep their six protocol rates, seven vaults and saved 80/8/3/4/5 split. The reviewed eight-category configuration and 1% future-launch referral policy are published on Devnet. Normal agency launches and real executor acceptance remain gated. `config/protocol-fee-split.js` remains the historical fallback; it does not reprice existing launches.

Required before activation:

1. Backward-compatible V3 contract extension with a dedicated eighth agency category, immutable selections, per-agent budgets, and protected spending. Existing approvals, recovery restrictions, and retired-mint collection pause must remain intact.
2. Update browser instruction builders, account decoding, launch readiness, signed policy, launch registration, settlement proofs, funding reconciliation, public metrics, and accounting to understand the agency category. Preserve all existing mint formats.
3. A durable agency executor that claims one intent per mint/agent atomically, journals signed transactions before broadcasting, reconciles uncertain results without resubmission, and cannot overspend or mix budgets.
4. Fresh USD observations derived from verified own-mint finalized pool state and USD oracle data. A caller-supplied `finalized` field or market-cap number is not chain proof; the local trigger evaluator alone is not execution authorization.
5. An X promotion adapter using the existing durable outbox and account verification, with source-linked content, posting cadence and cost accounting. Existing tier launch posts and daily payout summaries must not be confused with paid agency delivery. No promotional posts have been submitted by this candidate.
6. Protected own-coin purchase and `BurnChecked` execution, slippage limits, correct token-program/mint checks, atomic burn where supported, verified SOL debit/token burn/supply deltas, and linked finalized receipts.
7. Contract VM tests, current-source SBF build, reviewed Devnet upgrade and hash pin, then disposable-wallet end-to-end launch/collection/settlement/agency funding/X post/100k/300k tests. Mocked threshold observations do not prove real market-cap crossings.

The initial October 19 local pass did not submit an agency upgrade, policy change, X promotion, purchase or burn. The later October 20 upgrade/configuration proofs are recorded separately; no agency execution receipt or balance is inferred from an HTTP response or UI render.

## Local verification on 2026-10-19

- Focused agency unit tests: 13 passed.
- Full working-tree unit run: 936 passed, 9 skipped, 0 failed. This run included pre-existing changes from another ongoing task; it is not an isolated release revision.
- Agency and launch-package browser regressions: 14 passed with mocked/offline APIs. After the final desktop sidebar spacing change, the five agency browser checks were rerun and passed.
- Production build and source-size budgets passed. The build retains the existing large-chunk warning.
- Desktop and mobile screenshots were inspected; the desktop sidebar overlap was corrected and checked after transitions completed.
- No new on-chain or live X agency execution was verified. This records initial local preparation; later app releases may carry this inactive preview without activating its contract budget or executors.

Ignored local evidence: `tmp/marketing-agency-all-unit.log`, `tmp/marketing-agency-focused-final.log`, `tmp/marketing-agency-browser.log`, `tmp/marketing-agency-browser-final.log`, `tmp/marketing-agency-build.log`, `tmp/agency-desktop.png`, and `tmp/agency-mobile.png`.
## Independent buyback execution during an X suspension

The dedicated `agency-buyback-worker` runs only Agents 2 and 3. It has no X
credentials, publisher or outbox. `FUNDED_V3_AGENCY_BUYBACK_ENABLED=true` enables
this worker only with the reviewed Devnet binary, active lookup table and fresh
exact-build heartbeat. Normal launch activation remains a separate acceptance
gate. The worker independently verifies each immutable mint policy, finalized
source collections, settlement counters and protected budget before spending.

Agent 1 remains paused while X publishing is disabled or the account is
suspended. Selecting it reserves its share; it does not publish or bill. The
page reports this pause separately from buyback-agent availability and from
publication of the 1% referral / 2% agency policy. Reinstatement alone does not
start either publisher; a separate reviewed activation is required.

Agents 2 and 3 use the mint's saved verified USD market-cap thresholds
(defaults $100,000 / $300,000), one execution per agent per mint, protected payer reserve and
finalized debit/burn receipt checks. Availability is not an executed burn.

### Worker diagnostics

Agency workers emit `agency-worker-step` or `agency-buyback-worker-step` JSON
records. Match `cycleId` and `step` to pair a `started` record with its
`completed`, `pending`, or `failed` record. A start without an end identifies
the last in-flight phase if a worker stalls or exits. `elapsedMs` uses a
monotonic clock. Nested phase durations overlap; do not sum them. The final
cycle record includes `diagnostics.cycleDurationMs` and the last 128 completed
steps, with `droppedSteps` reporting truncation.

Phases distinguish deployment, lookup-table and publisher verification,
state/custody reads, market observations, quotes, execution, execution proof,
promotion, dispatch, billing and heartbeat writes. A completed phase means
the call returned; only the existing receipt verification establishes a
finalized purchase or burn. An unmigrated market remains `pending`.

Failures include only allowlisted reason codes, phase, duration and public
mint/agent identifiers. Provider messages, URLs, credentials, stacks and
transaction payloads are excluded from these diagnostic records. Unknown
errors remain `verification-unavailable`; HTTP status alone does not identify
which provider failed. `market-snapshot-stale`, `price-reference-unavailable`
and `price-reference-stale` distinguish the market freshness gates. These
codes do not claim why an upstream price reader returned no reference.

The existing `adminSettings.agencyWorker` / `agencyBuybackWorker` heartbeat
writes retain the bounded diagnostic snapshot. Its final heartbeat-write
duration is available in logs after that write completes. Public budget
summaries do not include diagnostics. Blocked-cycle records also carry the
innermost failed phase and are logged before attempting to save the blocked
heartbeat, so a database failure cannot hide the original diagnostic.

Diagnostics never renew readiness on a step start, retry a transaction or
change the 90-second readiness window, 60-second market freshness limit,
protected reserve, fee policy or creator-buy limit. Logger failures do not
interrupt the worker. Investigate the recorded phase before changing any
readiness gate; a previous generic outage cannot be attributed retroactively.

## Manual promotion delivery and Devnet activation

When admin-email delivery is configured, Agent 1 is shown as **Email drafts enabled**. It emails the existing launch draft and the paid-package migration draft with a Post to X action. The administrator reviews and publishes the post. This mode does not enable recurring automatic X posts or charge the protected agency promotion budget.

The buyback-only worker must share the app's existing independent price-signer public address, HTTPS endpoint and token secret mount. `scripts/agency-service-config.mjs` copies only those settings and fails closed if an enabled worker lacks them. Activation still requires the reviewed Devnet program, exact-build worker evidence, saved per-token thresholds, protected budget, migration and finalized purchase/burn verification.
