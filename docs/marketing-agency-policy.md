# AI marketing agency candidate

Latest contract, custody-verification, durable-execution and integration evidence:
[2026-10-19 checkpoint](agency-contract-integration-2026-10-19.md).
The sections below record the initial preview. New contract/executor source is
now implemented locally and tested; normal launch/runtime activation and live
agency acceptance remain incomplete. The candidate is not deployed or active.

## Approved rules

Applies to every new launch after activation. Existing mint policies and historical allocations retain their signed rates.

| Gross collected creator fees | Allocation |
| --- | --- |
| Creator-directed | 80% |
| Operations & marketing | 8% |
| Referrals | 1%: L1 0.6667%, L2 0.2%, L3 0.1333% |
| AI marketing agency | 2% |
| Daily bonus | 4% |
| Existing $FUNDED buyback | 5% |

Agency budget is split equally among selected agents, using cumulative integer rounding. No selection retains the allocation in the agency reserve. It does not restore the 3% referral share. The existing $FUNDED buyback budget is separate.

1. Agent 1 promotes the launched project through the funded.vip X account at most once per coin per 24 hours. Its accumulated agency share is billed only after the post is independently verified. A verified but unbilled post blocks another post until billing is reconciled. The next durable sequence becomes eligible 24 hours after verified delivery; an uncertain intent is reconciled rather than retried as a fresh promotion.
2. Agent 2 buys and burns that same coin once at verified USD market cap >= $100,000.
3. Agent 3 buys and burns that same coin once at verified USD market cap >= $300,000.

Each milestone can spend only its own accumulated agency budget. Later allocations remain reserved after a one-time action. A missing quote, incomplete market data, insufficient spendable funds, uncertain submission, or missing proof does not count as execution.

## Implemented locally

- Dedicated `#marketing-agency` navigation and responsive page.
- Launch promotion team selection preview with equal-share explanation.
- Candidate configuration, exact cumulative allocation projection, deterministic one-time intent IDs, and trigger decision evaluator.
- Read-only `/api/marketing-agency` exposes unavailable financials and explicit activation blockers.
- Client refuses selected agency submissions before connecting/signing; server rejects agency launch registration before storage or chain side effects.
- Unit tests cover conservation, all selection subsets, u64 amounts, threshold boundaries, stale/wrong network/wrong mint observations, and repeated/uncertain intents. Browser fixtures cover desktop/mobile routing, team selection, unavailable financials, and retry.

## Incomplete — do not describe as active

The deployed V3 layout has six protocol rates and seven vaults. The active split remains 80/8/3/4/5. This candidate does **not** activate 1% referrals or collect agency funds. `config/marketing-agency.js` is separate from `config/protocol-fee-split.js` deliberately until the full policy can be enforced.

Required before activation:

1. Backward-compatible V3 contract extension with a dedicated eighth agency category, immutable selections, per-agent budgets, and protected spending. Existing approvals, recovery restrictions, and retired-mint collection pause must remain intact.
2. Update browser instruction builders, account decoding, launch readiness, signed policy, launch registration, settlement proofs, funding reconciliation, public metrics, and accounting to understand the agency category. Preserve all existing mint formats.
3. A durable agency executor that claims one intent per mint/agent atomically, journals signed transactions before broadcasting, reconciles uncertain results without resubmission, and cannot overspend or mix budgets.
4. Fresh USD observations derived from verified own-mint finalized pool state and USD oracle data. A caller-supplied `finalized` field or market-cap number is not chain proof; the local trigger evaluator alone is not execution authorization.
5. An X promotion adapter using the existing durable outbox and account verification, with source-linked content, posting cadence and cost accounting. Existing tier launch posts and payout congratulations must not be confused with paid agency delivery. No promotional posts have been submitted by this candidate.
6. Protected own-coin purchase and `BurnChecked` execution, slippage limits, correct token-program/mint checks, atomic burn where supported, verified SOL debit/token burn/supply deltas, and linked finalized receipts.
7. Contract VM tests, current-source SBF build, reviewed Devnet upgrade and hash pin, then disposable-wallet end-to-end launch/collection/settlement/agency funding/X post/100k/300k tests. Mocked threshold observations do not prove real market-cap crossings.

No agency contract upgrade, live financial policy change, X promotion, purchase or burn is performed by this candidate. No agency receipt or balance is invented from an HTTP response or UI render.

## Local verification on 2026-10-19

- Focused agency unit tests: 13 passed.
- Full working-tree unit run: 936 passed, 9 skipped, 0 failed. This run included pre-existing changes from another ongoing task; it is not an isolated release revision.
- Agency and launch-package browser regressions: 14 passed with mocked/offline APIs. After the final desktop sidebar spacing change, the five agency browser checks were rerun and passed.
- Production build and source-size budgets passed. The build retains the existing large-chunk warning.
- Desktop and mobile screenshots were inspected; the desktop sidebar overlap was corrected and checked after transitions completed.
- No new on-chain or live X agency execution was verified. This records initial local preparation; later app releases may carry this inactive preview without activating its contract budget or executors.

Ignored local evidence: `tmp/marketing-agency-all-unit.log`, `tmp/marketing-agency-focused-final.log`, `tmp/marketing-agency-browser.log`, `tmp/marketing-agency-browser-final.log`, `tmp/marketing-agency-build.log`, `tmp/agency-desktop.png`, and `tmp/agency-mobile.png`.
