# Reward experience implementation and QA — 2026-10-01

## Implemented in this checkout

- Rewards Overview now includes a wallet summary for creator allocations without payout proof, finalized SOL payments, open referral claims, and X claims after X sign-in. Coin holder payment rows link to finalized transaction receipts.
- The rewards discovery list separates a published holder share from allocated fees and actual holder payments. Its ranking uses distinct paid wallets and latest payment time, with no person or yield claim.
- The token fee panel has a five-stage public proof view: policy, collection, allocation, holder payment, and buyback burn. It links to transaction receipts. A holder payment is marked fee-funded only when its schedule references a funded pool whose immutable request links to a receipt-verified fee collection and whose funding signature and amount agree.
- Launch settings include three 80% creator-directed split examples that fill the existing form only when selected. The final launch review and service validation still govern signing.
- The community page shows receipt-backed reserve allocations, without inventing spending totals. Watched coins can generate opt-in in-app notices from verified events while the page is open. This is device-local polling, not push delivery.
- The buyback page separates queued amounts from finalized, refund-verified buy and burn receipts.

The new read-only API is `GET /api/rewards/experience` with optional `wallet` and `mint` queries. It returns `unavailable` when finalized receipt coverage cannot be established. Totals use the available finalized receipt window, not an all-time index.

## Verification observed in this checkout

- `node --test tests/reward-experience.test.mjs`: 5 passed. Cases cover verified collection and allocation, missing proof exclusion, address validation, token/SOL separation, and fee-funded pool linkage.
- `npm.cmd run build`: passed.
- `npm.cmd run verify:automatic-rewards`: passed against a mocked chain.
- `npm.cmd run verify:buyback-policy`, `verify:receipt-evidence`, and `verify:coin-detail`: passed.
- A local server using an isolated empty JSON store returned `evidence=no-records` and no tokens from the new API; malformed wallet query returned HTTP 400. Headless Chrome confirmed the Rewards Overview, Community, and Buyback panels render and the token proof panel attaches without a browser exception. The isolated fixture has no financial activity and is not a Devnet payout test.
- `npm.cmd run verify:proof-ui` failed on an existing exact-text assertion for `Ranked by verified contribution` in `app.js`. This task did not change that copy or test.

## Live rollout limits

The default local server could not start because PostgreSQL on `localhost:5432` refused connections. The isolated JSON store allowed UI and API smoke checks but has no public receipt history. Previous Devnet QA proved direct QA-funded holder payouts and a separate fee-funded buyback; it did not prove a creator-fee-funded holder payout. That payout requires an attributed holder pool above the 0.01 SOL distribution minimum, complete finalized holder snapshots, and a completed period. No mainnet deployment or new Devnet transaction was performed by this change.

The optional idea discussion on the community page is not a voting or reserve-spending mechanism. Persistent alerts and governance would need authenticated subscriptions, delivery infrastructure, moderation, and payout controls before launch.
