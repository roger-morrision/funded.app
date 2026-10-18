# V3 rewards: automatic delivery, claims and approvals

## Current product rules

The current preview uses Devnet and V3 per-mint fee policies. Default gross creator-fee allocations are 80% creator-directed, 8% Operations & marketing, 3% referral network, 4% Daily bonus and 5% $FUNDED buyback. A saved admin policy overrides protocol defaults for future launches; existing coins keep their saved policy. Percentages apply to collected creator fees, not trade volume.

| Program | Asset | Recipient action | Required evidence |
| --- | --- | --- | --- |
| Creator wallet | SOL | Creator reviews/signs available settlement, funding and payout actions | Saved wallet share; finalized collection, settlement and transfer |
| Coin holders | SOL | Automatic; no claim or recipient signature | Funded pool, complete finalized holdings, prices and applicable minima |
| X account | SOL | Named X account signs in, links receiving wallet and claims | Identity, ownership, funding and finalized receipt |
| Referral network | SOL | No recipient claim; creator approves V3 transfers | Frozen first-touch upline, collected fees and finalized transfer |
| Daily bonus | SOL | Automatic; no claim or recipient signature | Completed UTC day, verified rankings and exact source funding |
| Community airdrop | Launched coin tokens | Eligible wallet claims within displayed window | Token custody, verified eligibility snapshot and claim proof |

### Holder cadence and conditions

Standard holder periods close hourly, with finalized samples normally every five minutes. Defaults include US$20 reference-equivalent holdings, at most 1,000 eligible wallets, and a funded pool meeting 0.01 SOL and the US$20-plus-cost condition. The economic allowance is US$0.01 per recipient; transaction/account costs are paid separately. Missing prices or incomplete coverage blocks preparation; small pools carry forward. Selected Devnet QA mints can use reduced minima and five-minute periods with one-minute samples. See [QA configuration](devnet-qa-minimums.md) and each coin's conditions.

### Daily bonus and history

Each completed UTC day closes at 00:00 UTC. The pool splits equally between creators, direct referrers and traders; ranks 1/2/3 receive 50/30/20 within each group. Scores use collected creator fees, direct referred collected fees and finalized buy/sell SOL volume respectively. Ties use wallet address order; unfilled ranks retain their share. The worker checks every five minutes and automatically executes funded, verified snapshots. A cutoff does not guarantee immediate payment. See [Daily bonus rules](daily-bonus-policy.md).

Home shows verified indexed category allocations and the next UTC cutoff. `#bonuses` shows paginated finalized history and all-time recipients across all recorded snapshots. Rewards History and Analytics independently verify transactions, payment accounts and balance changes. Combined category receipts are counted once. Wallet profiles have separate activity sources and authentication boundaries.

An allocation, vault funding, submitted transaction and finalized payment are different stages. Mocked tests and dated QA receipts do not establish a current-source payout. Sources: [holder defaults](../automatic-rewards.js), [Daily policy](../config/daily-bonus.js), [runtime](../server/daily-bonus-runtime.mjs), [service](../server/daily-bonus-service.mjs), [history proof](../server/daily-bonus-payment-history.mjs), [fee configuration](protocol-fee-split-config.md).

## Historical implementation and QA chronology

The material below records earlier revisions and retired delivery models. Manual referral claims, earlier program IDs, old minima and activation states below are historical, not current V3 instructions. Use the current rules above; Git preserves the original chronology.

Status: the payout contract is deployed on Devnet. Fee collection, SOL/token transfers, buy-and-distribute, and the scheduler have been live-verified there; the scheduler verification used a one-shot local worker rather than claiming a continuously deployed worker. Holder indexing uses the configured Helius endpoint, reads accounts at finalized commitment, and accepts a snapshot only when its balances exactly equal finalized mint supply. Current live holder periods below the 0.01 SOL funding minimum are correctly deferred. Mainnet remains disabled pending a separate audit and release authorization.

The existing 80/20 fee rule is unchanged. Creator-directed SOL can be delivered to creators, eligible coin holders, and verified X wallets. Referral rewards remain manual claims. Token rewards can use the same automatic cycle after the token reserve is funded and holder eligibility is finalized. Optional buy-and-distribute converts a bounded SOL budget into the launched token, verifies the exact token balance increase, funds the reward vault, and then schedules token payouts.

## Implemented

- Anchor reward vault, immutable Merkle-root cycle, one-payment PDA per recipient, payout-time gate, cycle-total cap, permissionless execution, direct SOL payout, and checked SPL/Token-2022 payout.
- Deterministic JS Merkle manifests and matching vault/cycle/payment PDA derivation.
- Finalized SPL holder snapshots persisted by mint and slot. The daily model uses time-weighted balances from fixed-interval samples, rejects missing boundaries or oversized gaps, aggregates token accounts by wallet, and supports explicit vault/pool exclusions. Program scans, paginated indexed token-account discovery, and a small-holder-set fallback all require exact finalized supply coverage.
- Durable per-mint UTC schedules with cutoff, payout time, allocation manifest, cycle address, recipient-level confirmation evidence, and restart-safe status.
- The deployed Devnet program supports mint-specific routing and settlement, and the funded.vip Devnet app has enabled the route after a finalized mint-router settlement test. X credentials and verified identity still gate an actual X claim.
- SOL funding from the existing per-mint fee router into the constrained reward vault, with an immutable settlement claim and exact finalized vault delta.
- Automatic SOL and token payout adapters. A payout is marked paid only after a finalized payment PDA and the expected recipient balance delta are both observed.
- Token-vault funding with idempotent associated-token-account creation and exact finalized token deltas.
- Deterministic one-time launched-token community allocation builder and an additive 90-day on-chain claim candidate. No production claim cycle has an independently verified migration-time `$FUNDED` snapshot; live community claims remain closed.
- Optional Pump/PumpSwap buy-and-distribute executor with explicit enablement, maximum budget, slippage cap, price-impact cap, minimum output, finalized acquired-token delta, and a second verified vault-funding delta.
- Live `/api/rewards/automatic` status sourced from the durable reward ledger. Schedules are shown only when recorded; service activity expires when worker readiness becomes stale.
- Referral exclusion. Referrals continue through the existing user-signed manual claim flow.

## Routes still gated

### Creator-approved fee funding (2026-10-12 follow-up)

The Devnet release at `6df6c29` gives holder, operations, and community-reserve SOL allocations from a verified per-mint collection distinct immutable mint-router claim IDs. The launch creator can review pending allocations in the coin fee dashboard and sign one exact transaction per allocation. The server checks the verified launch, collection, fee split, router, creator ledger, program bytecode, destination vault, creator signature, finalized claim record, and exact router-to-vault balance delta. The worker never attempts to spend an unsigned allocation: it only reconciles a saved, finalized creator-approved receipt before marking a funding request funded or scheduling payouts. Community reserve funding transfers SOL to the program reserve; it does not open a community token claim cycle. The bounded live funding transfers remain unverified.

`GET /api/tokens/:mint/reward-funding/pending` lists verified allocations. `POST /api/tokens/:mint/reward-funding/settle` first prepares an exact transaction for `requestId`; a second call with `creatorSignedTransaction` submits and verifies it. A verified vault transfer returns `vault-funded` while the worker schedules or records the allocation. A finalized holder payment or operations payment still requires a separate on-chain reward cycle and recipient delta. The Devnet QA mint has not completed those signed transfers, and its holder allocation remains below the 0.01 SOL scheduling minimum. A community claim still requires a finalized migration-time `$FUNDED` snapshot. A real X payout still requires a verified X identity and a launch with an X allocation.

The exact-SHA production image build passed. The Windows-supported unit suite passed 645 tests with three skips; six maintenance-lock tests passed under WSL. Local mocked Playwright passed 99 tests. These checks validate code and browser behavior. The creator-approved holder, operations, and community transfers have no new finalized Devnet signatures, so their live payout statuses remain unverified. A bounded QA run stopped before signing because its comparison added the settlement result rather than its instruction. A later request to compare against the live unsigned settlement endpoint was rejected by automatic approval review because preparation may mutate the shared ledger. The corrected comparison has an offline synthetic regression; no later live settlement request was made.

The user subsequently approved one bounded signed test for the disposable QA mint. `scripts/qa-reward-funding-devnet.mjs` is read-only by default; `--execute` checks the exact source signature, three immutable request IDs and amounts, program bytecode, creator, authority, router rent floor, prepared transaction message, and finalized claim plus exact router/vault balance deltas. It does not create a mint or run holder, X, or token payouts. Preparing an allocation only derives its reward-vault address; the server may initialize a missing vault after it verifies the creator's exact signed transaction and confirms its blockhash is still valid. The test must run only after `compose.exact-devnet-release.yml` has aligned the app image and all workers with the new router ID and reviewed bytecode hash. A finalized holder funding transfer does not by itself establish a holder payment; the current holder amount is below the 0.01 SOL scheduling minimum.

Read-only release preflight initially found the app and reward worker pinned to the old router program `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`. The public Devnet release now advertises `61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa` and bytecode hash `65993e0b50fcf6650ecaa6e8e4b23c1ff345547e55c2d7b07ead4ba81333c77d`; finalized RPC independently matched that hash. All six app/worker containers run the same `6df6c29` image and build ID. The QA authority and creator wallets have sufficient Devnet SOL for transaction fees; no top-up is identified as a blocker.

The running Devnet app loads X OAuth and user-lookup configuration from ignored `.env.x` plus the matching mounted secret files. `/api/x/oauth/start` returns an X authorization redirect with the configured HTTPS callback; a real account sign-in has not yet been completed. The deployed router has passed finalized mint initialization and settlement checks, and the funded.vip Devnet gate is enabled. The local readiness check pins the deployed program bytecode. A real X payout remains unverified until OAuth identity, destination wallet, Pump fee collection, and finalized payout delta are jointly observed. Buy-and-distribute to holders has separate Devnet evidence above. The current router has one independently verified fee-funded buy-and-burn receipt for the disposable QA mint; broader custody and audit checks remain pending. Community claims require the custody and exact-slot eligibility work in `docs/community-airdrop-devnet.md`. Creator and holder payouts continue under the 0.01 SOL minimum; a deferred period is not a failed settlement. Referral rewards remain user-signed manual claims with receipt reconciliation.

### Historical operational model

The current V3 source schedules complete UTC hours with five-minute finalized holder snapshots and payout after each hourly cutoff. New and migrated programs start with the next complete hour. Unprepared daily schedules are skipped during migration; already prepared or partly paid manifests remain intact. A funded hourly cycle requires a fresh verified SOL and token price, at least US$20 equivalent in each recipient wallet at the closing snapshot, no more than 1,000 eligible recipients, and a pool of at least 0.01 SOL and US$20 equivalent plus a US$0.01-equivalent cost allowance per recipient. The allowance is an economic gate; the app authority pays transaction costs separately and the holder pool is not silently reduced. Devnet USD figures are reference-equivalent test thresholds, not realizable market values. Unfunded or subminimum pools carry forward. Missing prices, incomplete finalized history, ineligible holders, or excess recipient counts block preparation without spending the pool. Historic daily receipts remain evidence for their original periods; this source change is not proof of an hourly live payout.

The worker command is:

```text
npm run rewards:scheduler
```

For the local Compose Devnet profile, resolve protected values from both ignored environment files: `docker compose -f compose.funded-vip.yml -f compose.reward-worker.yml --env-file .env.deploy --env-file .env.local --profile automatic-rewards up -d reward-worker`. The worker exits before processing if neither authority key is present.

Required deployment inputs are `SOLANA_RPC_URL` or `SOLANA_DEVNET_RPC_URL`, `FUNDED_FEE_ROUTER_PROGRAM_ID`, `FUNDED_ROUTER_AUTHORITY_SECRET_KEY` or its keypair path, `FUNDED_REWARD_PROGRAM_DATA_SHA256`, and `AUTOMATIC_REWARD_STORE_PATH`. `SOLANA_HOLDER_INDEX_RPC_URL` is optional when the primary endpoint supports complete enumeration. If a provider blocks program scans, the worker tries paginated `getTokenAccounts`, rereads every discovered account at finalized commitment, and reconciles the sum to finalized mint supply. It accepts largest-account results only when those balances also equal supply; partial holder data is always rejected. On Devnet only, the worker may use `SOLANA_DEVNET_CREATOR_SECRET_KEY` as the router-authority fallback. `FUNDED_REWARD_PROGRAMS_JSON` is an optional bootstrap list; verified launches with holder rewards register themselves in the shared durable store. The worker rejects non-Devnet configuration. Production enablement requires a separately audited and authorized deployment.

### Historical verification

- `npm run verify:automatic-rewards` verifies allocation, Merkle proofs, sampled history, scheduling, restart behavior, manual referral exclusion, and buy policy with a mocked chain.
- `npm run verify:reward-contract-source` checks contract controls plus JS manifest/PDA parity.
- The Anchor crate compiles to SBF with Anchor 1.2.0/Solana 4.1.2, and its Merkle unit test passes.
- `npm run verify:reward-devnet` checks the live Devnet genesis, executable program, upgradeable program-data hash, and uses only in-memory ephemeral wallets. With `DEVNET_REWARD_E2E=true`, it performs one SOL vault/cycle/payout flow and requires finalized account and balance deltas.

The Devnet program is `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`; its finalized program-data account is `DrQmTSxHsRACofnAA6oLgfrSxQfLZFDvNmnu3Rz37EVA`, pinned by SHA-256 `6e7dcd6f610ef6fd1729a9819d0e173b52932de82985ee870a8d835e7d168740`. Deployment signature `9Qgv3pR7pketf4TLzWx5iQPys9dYshMVjdy3FXDpnSg3a7PvKpMyx57k8mbL259kGGkVmmjThKc8z8FHip5Fy1P` and router initialization signature `5yHoueq2yEzmFb4d4S7WKAiNFzwgWiis3nDKnvGbLq1BUenLUwof7cawvRncyG8iUdwUPjcq89juX5F7Fy7JprJV` are Devnet evidence, not Mainnet readiness.

The completed ephemeral-wallet proof covered both assets. SOL payout signature `5zioTHNNGi6soGE78PKaaTVR5VtcWRqogKUARAoVjHFJ9AYm3HJCpUcMRdGoD7B8xBJ1dXjCAn7TwATNvbT3t1HH` created payment PDA `61J1m15hyWkxSJk53oYbvpuT3ighPPwq3MNB951FzB1c`; checked SPL-token payout signature `3ZU89WozPUndzzz75UXiHPToFCc12hdaEB5noRCvP8QcKC3fq9RN7iifwvoNmSZ1feJu7bqXExYWWp7k53Ppttji` created payment PDA `z569PWhrmkW4WWZV5neUkwSBovfU7Xf8T8FkAuE9tiy`. The verifier observed finalized payment records and exact recipient balance deltas for both; no ephemeral private key was persisted.

The full fee path was also verified with disposable mint `J3zS78M11iQz3vqHhuwjqzkT5gyLu2g9oSKsqf8YS8Vd`: mint-router initialization `2CcbCY1MQjayL6LRfE95K6wuVxP8jZsiuj17RSUmqRy8uVqFwAmRjQ1Zdv9CKqY48y5gQkJ1uC9Ms29Ujz9t2Cym`, Pump launch `3Aq645nubbfJ5nVYfiT6H6B2hFcAyoTBuF3rTtgVKWqgffk2EKkQ6sqELAHoND3QpyEnDs5DUh4ViLfdbUwrWNqW`, creator-fee collection `5xB2JEiq6AERnKxBKzA6G34hTGjVaDoWR8mmCrLcz6y46UhYY3gfeW8CY5xtDBcumRFgiQrEDGjveiKzVUSm7Ezt`, and exact 29,703-lamport reward-vault funding `3ijzguXEy8XjzJ3DQJZ1JRjvkVCHUmbshGiqRtBYTmYXnqvqy9wpmJGnHS6B9hELAam1tAmau4etyKs7LqPxcxvi`.

Optional buy-and-distribute is live-verified for the same disposable mint. Buy signature `5Y2VhuoKU1yGEia22qEKTHHsL47ybnB1szRWv2jqxHykGxc44rAr1RPt51ews7mWx3avzNHyE3bVqSmrcYjdr6Dw` acquired 5,182,830,099,105 base units; token-vault funding signature `X1nshZGzVKqhw3SYpBiQoMB1vzbigRvKjuWZfC1wysEoSdjWetfkfyRBycPy1TJhQY9EF1tRAsLSnhc3C2AsPUK` produced the required finalized vault delta.

Uncertain submissions remain `verification-pending`; they are not retried under a new ID. The file ledger is suitable for one worker with a shared persistent volume. Multi-host production operation should move the same state transitions to PostgreSQL with advisory locks before Mainnet activation.
