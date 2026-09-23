# Automatic reward delivery

Status: the payout contract is deployed on Devnet. Fee collection, SOL/token transfers, buy-and-distribute, and the scheduler have been live-verified there; the scheduler verification used a one-shot local worker rather than claiming a continuously deployed worker. Holder indexing uses the configured Helius endpoint, reads accounts at finalized commitment, and accepts a snapshot only when its balances exactly equal finalized mint supply. Mainnet remains disabled pending a separate audit and release authorization.

The existing 80/20 fee rule is unchanged. Creator-directed SOL can be delivered to creators, eligible coin holders, and verified X wallets. Referral rewards remain manual claims. Token rewards can use the same automatic cycle after the token reserve is funded and holder eligibility is finalized. Optional buy-and-distribute converts a bounded SOL budget into the launched token, verifies the exact token balance increase, funds the reward vault, and then schedules token payouts.

## Implemented

- Anchor reward vault, immutable Merkle-root cycle, one-payment PDA per recipient, payout-time gate, cycle-total cap, permissionless execution, direct SOL payout, and checked SPL/Token-2022 payout.
- Deterministic JS Merkle manifests and matching vault/cycle/payment PDA derivation.
- Finalized SPL holder snapshots persisted by mint and slot. The daily model uses time-weighted balances from fixed-interval samples, rejects missing boundaries or oversized gaps, aggregates token accounts by wallet, and supports explicit vault/pool exclusions. Program scans, paginated indexed token-account discovery, and a small-holder-set fallback all require exact finalized supply coverage.
- Durable per-mint UTC schedules with cutoff, payout time, allocation manifest, cycle address, recipient-level confirmation evidence, and restart-safe status.
- Every new launch uses its own mint-specific fee router, so collection and reward funding remain attributable without requiring an X reward selection. X credentials gate only the optional X destination.
- SOL funding from the existing per-mint fee router into the constrained reward vault, with an immutable settlement claim and exact finalized vault delta.
- Automatic SOL and token payout adapters. A payout is marked paid only after a finalized payment PDA and the expected recipient balance delta are both observed.
- Token-vault funding with idempotent associated-token-account creation and exact finalized token deltas.
- One-time launched-token airdrops from a finalized `$FUNDED` eligibility snapshot, with excluded wallets, immutable snapshot slot, pro-rata allocation, and automatic token delivery.
- Optional Pump/PumpSwap buy-and-distribute executor with explicit enablement, maximum budget, slippage cap, price-impact cap, minimum output, finalized acquired-token delta, and a second verified vault-funding delta.
- Live `/api/rewards/automatic` status sourced from the durable reward ledger. Schedules are shown only when recorded; service activity expires when worker readiness becomes stale.
- Referral exclusion. Referrals continue through the existing user-signed manual claim flow.

## Operational model

The default period is 24 hours, with five-minute finalized snapshots, cutoff at 00:00 UTC, and payout at 01:00 UTC. A newly activated program starts with the next complete UTC period; earlier partial periods are marked skipped and their verified funding rolls forward. A schedule is blocked if finalized history has a gap greater than two sampling intervals, if no balance-verified pool funding exists, or if there are no eligible holders. SOL pools below 0.01 SOL carry forward.

The worker command is:

```text
npm run rewards:scheduler
```

For the local Compose Devnet profile, resolve protected values from both ignored environment files: `docker compose -f compose.funded-vip.yml -f compose.reward-worker.yml --env-file .env.deploy --env-file .env.local --profile automatic-rewards up -d reward-worker`. The worker exits before processing if neither authority key is present.

Required deployment inputs are `SOLANA_RPC_URL` or `SOLANA_DEVNET_RPC_URL`, `FUNDED_FEE_ROUTER_PROGRAM_ID`, `FUNDED_ROUTER_AUTHORITY_SECRET_KEY` or its keypair path, `FUNDED_REWARD_PROGRAM_DATA_SHA256`, and `AUTOMATIC_REWARD_STORE_PATH`. `SOLANA_HOLDER_INDEX_RPC_URL` is optional when the primary endpoint supports complete enumeration. If a provider blocks program scans, the worker tries paginated `getTokenAccounts`, rereads every discovered account at finalized commitment, and reconciles the sum to finalized mint supply. It accepts largest-account results only when those balances also equal supply; partial holder data is always rejected. On Devnet only, the worker may use `SOLANA_DEVNET_CREATOR_SECRET_KEY` as the router-authority fallback. `FUNDED_REWARD_PROGRAMS_JSON` is an optional bootstrap list; verified launches with holder rewards register themselves in the shared durable store. The worker rejects non-Devnet configuration. Production enablement requires a separately audited and authorized deployment.

## Verification

- `npm run verify:automatic-rewards` verifies allocation, Merkle proofs, sampled history, scheduling, restart behavior, manual referral exclusion, and buy policy with a mocked chain.
- `npm run verify:reward-contract-source` checks contract controls plus JS manifest/PDA parity.
- The Anchor crate compiles to SBF with Anchor 1.2.0/Solana 4.1.2, and its Merkle unit test passes.
- `npm run verify:reward-devnet` checks the live Devnet genesis, executable program, upgradeable program-data hash, and uses only in-memory ephemeral wallets. With `DEVNET_REWARD_E2E=true`, it performs one SOL vault/cycle/payout flow and requires finalized account and balance deltas.

The Devnet program is `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`; its finalized program-data account is `DrQmTSxHsRACofnAA6oLgfrSxQfLZFDvNmnu3Rz37EVA`, pinned by SHA-256 `6e7dcd6f610ef6fd1729a9819d0e173b52932de82985ee870a8d835e7d168740`. Deployment signature `9Qgv3pR7pketf4TLzWx5iQPys9dYshMVjdy3FXDpnSg3a7PvKpMyx57k8mbL259kGGkVmmjThKc8z8FHip5Fy1P` and router initialization signature `5yHoueq2yEzmFb4d4S7WKAiNFzwgWiis3nDKnvGbLq1BUenLUwof7cawvRncyG8iUdwUPjcq89juX5F7Fy7JprJV` are Devnet evidence, not Mainnet readiness.

The completed ephemeral-wallet proof covered both assets. SOL payout signature `5zioTHNNGi6soGE78PKaaTVR5VtcWRqogKUARAoVjHFJ9AYm3HJCpUcMRdGoD7B8xBJ1dXjCAn7TwATNvbT3t1HH` created payment PDA `61J1m15hyWkxSJk53oYbvpuT3ighPPwq3MNB951FzB1c`; checked SPL-token payout signature `3ZU89WozPUndzzz75UXiHPToFCc12hdaEB5noRCvP8QcKC3fq9RN7iifwvoNmSZ1feJu7bqXExYWWp7k53Ppttji` created payment PDA `z569PWhrmkW4WWZV5neUkwSBovfU7Xf8T8FkAuE9tiy`. The verifier observed finalized payment records and exact recipient balance deltas for both; no ephemeral private key was persisted.

The full fee path was also verified with disposable mint `J3zS78M11iQz3vqHhuwjqzkT5gyLu2g9oSKsqf8YS8Vd`: mint-router initialization `2CcbCY1MQjayL6LRfE95K6wuVxP8jZsiuj17RSUmqRy8uVqFwAmRjQ1Zdv9CKqY48y5gQkJ1uC9Ms29Ujz9t2Cym`, Pump launch `3Aq645nubbfJ5nVYfiT6H6B2hFcAyoTBuF3rTtgVKWqgffk2EKkQ6sqELAHoND3QpyEnDs5DUh4ViLfdbUwrWNqW`, creator-fee collection `5xB2JEiq6AERnKxBKzA6G34hTGjVaDoWR8mmCrLcz6y46UhYY3gfeW8CY5xtDBcumRFgiQrEDGjveiKzVUSm7Ezt`, and exact 29,703-lamport reward-vault funding `3ijzguXEy8XjzJ3DQJZ1JRjvkVCHUmbshGiqRtBYTmYXnqvqy9wpmJGnHS6B9hELAam1tAmau4etyKs7LqPxcxvi`.

Optional buy-and-distribute is live-verified for the same disposable mint. Buy signature `5Y2VhuoKU1yGEia22qEKTHHsL47ybnB1szRWv2jqxHykGxc44rAr1RPt51ews7mWx3avzNHyE3bVqSmrcYjdr6Dw` acquired 5,182,830,099,105 base units; token-vault funding signature `X1nshZGzVKqhw3SYpBiQoMB1vzbigRvKjuWZfC1wysEoSdjWetfkfyRBycPy1TJhQY9EF1tRAsLSnhc3C2AsPUK` produced the required finalized vault delta.

Uncertain submissions remain `verification-pending`; they are not retried under a new ID. The file ledger is suitable for one worker with a shared persistent volume. Multi-host production operation should move the same state transitions to PostgreSQL with advisory locks before Mainnet activation.
