# Devnet migration and upgrade acceptance, 25 November 2026

This report extends the earlier [configurable Devnet app test](configurable-devnet-app-2026-11-25.md). The earlier funding estimate was incorrect: the live Devnet Pump quote to complete the selected curve was 824,396,377 lamports. The test migration and both AI milestone burns subsequently finalized. Final acceptance results and public receipts are recorded in `evidence/devnet-upgrade-full-flow-2026-11-25.json`.

## Changes under test

- Holder snapshots run in a separate observer with only Devnet RPC access and the shared, locked reward ledger. It has no signing credentials. App and program deployments leave that observer running. Payouts still require complete finalized holder history; missing history is never fabricated.
- Cumulative settlement reconstruction recognizes `buyback_configured_mint_v3` and `buyback_configured_agency_mint_v3`. Both change withdrawal counters without changing settled totals. The live migration test exposed that these discriminators were missing from the history validator, blocking a later creator/holder funding allocation. Unknown writable policy mutations still block payout.
- Signed AI milestone journals from the previous program commitment can be independently reconciled under the currently verified deployment. This path preserves their original immutable intent and cannot prepare, re-sign, rebroadcast or expire an old attempt. Unsigned stale-program intents remain blocked.
- The configurable program adds the account-free, read-only `program_revision` instruction. Its old bytecode rejects the instruction; upgraded bytecode logs `funded-configurable-abi-v1:20261125.1`. Existing financial instructions and account layouts are unchanged.
- Release preflight can sample container-root capacity from an explicitly selected running observer on the same local Docker daemon while financial services are drained. Workspace and container capacity thresholds still apply.

## Program upgrade

Program: `9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf`.

The [loader upgrade](https://explorer.solana.com/tx/khdJWfca3z5BbkVdqak2jURT83YojKsW4gFbe8jCn9cmV7KU91CzgDt1YkB3sT1Tpcuy6uMyjxZsiBjDJqqwR9f?cluster=devnet) finalized at slot **526044840**. All **198** program-owned accounts retained identical bytes and lamport balances, verified through both direct reads and an account scan. Upgrade authority was retained. The upload buffer closed and the 6.5 Devnet SOL rent loan was repaid in a finalized transaction.

| Commitment | Value |
| --- | --- |
| Previous ELF SHA-256 | `55a07af3f185f0dd42c7d80785438ec502e3c74d2382fb7910a7d66827c646e7` |
| New ELF SHA-256 | `bf3d7c28708a9398aaaea5852df1cf76166835cade85b415856d411c031e464f` |
| New ELF bytes | 1,206,632 |
| New finalized ProgramData SHA-256 | `db5f23382be5655a841c43423c1e96ad6696061d2cfdad266815756314399b89` |

The artifact was built with checksum-verified Agave 4.1.2, platform-tools 1.54, Rust 1.89 SBF, architecture v0, size optimization and stripping. Ten compiled-SBF configurable-asset tests passed, including payment commitments surviving token rotation, stale-revision rejection and the new read-only revision probe. These local tests are distinct from live Devnet execution evidence.

## Holder delay

The earlier third fixture first suffered incomplete sampling during an app deployment. Its retained funds later reached a fully indexed period, but the disposable recipient wallet had already been drained. Solana's minimum account balance prevented the small reward from being delivered. A finalized 0.001 Devnet SOL test-wallet top-up resolved that condition; the [113,575-lamport holder payout](https://explorer.solana.com/tx/oyta52oxtRWToKq8CKDYE47uUh5BqvFYU64wrJc9iMLg7tWRaEY4nq77H4mrTBGxnBiDXWj96uK6MppajrkVgpt?cluster=devnet) then finalized. Both recipient credit and reward-vault debit were independently checked.

The observer prevents deployment-induced sampling gaps. It does not waive funding thresholds, recipient account requirements, RPC failures or missing historical coverage. Its image is deliberately pinned separately from the six financial release services; replace it only with a separately verified observation handoff.

A second instance of the same underlying condition appeared post-upgrade: a referral-tier wallet reused as the second test token's migration payer had too little Devnet SOL to receive its daily-bonus share once that token's creator fees were collected, so both bonus snapshots for the post-upgrade mint sat `awaiting-recipient-funding`. A finalized 0.001 Devnet SOL top-up to that wallet let the scheduler retry; both snapshots then paid and were independently verified (6 receipts total, including the previously blocked ones). No ledger code changed for this case — only test-wallet funding, the same remediation as the holder delay above.

## Execution record

The final evidence file distinguishes pre-upgrade and post-upgrade launches, finalized collection and payout receipts, primary-token browser changes, migrated pools, AI burns, holder coverage and deployment identities. Only generated in-memory test wallets were used for interactive flows. Dedicated Devnet test funds paid fees; no generated private key was persisted.

Final acceptance passed: both pre-upgrade and post-upgrade flows (`before`/`after`) are `passed` with zero blockers, the deployed program hash matches the tested artifact, all 198 program-owned accounts and upgrade authority are intact, the holder observer ran uninterrupted through the cutover, and both migrated tokens' AI agency burns, holder payouts and daily-bonus payouts are independently verified on-chain. See `evidence/devnet-upgrade-full-flow-2026-11-25.json` for the complete machine-checked record. This rehearsal does not certify arbitrary future upgrades or Mainnet readiness.
