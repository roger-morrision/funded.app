# Claim flow audit — 2026-09-29

## Continuation — September 30

Implemented two source fixes: receipt amounts in `app.js` now use the existing integer-based formatter with all nine SOL decimal places; `automatic-rewards-ui.js` explains that reserve funding, snapshot eligibility and claim availability are separate checks, and directs readers to Airdrops for current evidence.

Validation passed: production build into `tmp/claim-ui-build-20260930`; automatic reward and receipt-evidence scripts; isolated creator HTTP signing, wrong-wallet, origin and replay checks; exact formatting for zero, one lamport, 356 lamports, one SOL and a u64 integer string. A browser-only mocked 356-lamport receipt rendered as `0.000000356 SOL` in all three receipt surfaces. The updated holder copy was verified in the browser. These are local-only/mocked checks, not new chain payments.

The isolated source app is running at http://127.0.0.1:15173 with API port 18879. Its Vite-origin request reached the claim eligibility gate (409 for no verified fixture launch); a foreign origin was rejected with 403. The deployed origin policy was not weakened. The source changes have not been deployed to Docker.

Live refresh is **blocked**: port 8788 is unavailable and Docker Desktop's Linux engine is down. Starting Docker Desktop failed; the current backend log reports `initializing Inference manager` and an inaccessible `C:/Users/<USER>/AppData/Local/Docker/run/dockerInference` listener. No factory reset or data-volume deletion was attempted. September 29 payout totals and schedules below remain historical observations, not reconfirmed September 30 status. Live X login, new payouts and migration/expiry claims remain unverified.

The remainder of this document records the original September 29 audit.

Tested the running Devnet Docker app at http://127.0.0.1:8788 and an isolated source instance at http://127.0.0.1:15173 (API 18879). The Docker app and its reward, receipt, fee-collector and buyback workers were already running and healthy. The source instance used a separate file ledger with test fixtures and no configured signing secrets. No production or saved wallet keys were used. No new payout was submitted by this audit.

## Results

| Flow | Verified in this run | Remaining limit |
| --- | --- | --- |
| Creator | Local signature challenge and HTTP request succeeded for a synthetic 0.011 SOL entitlement; ledger transitioned to pending. Wrong wallet (401), cross-origin (403), and replay (409) rejected. Two existing Devnet payments finalized and reconcile to 0.010481291 SOL. | Current live claimable balance is zero. Fresh live claim was not executed. |
| App owner / operations | Two existing finalized Devnet payments reconcile to 0.002096258 SOL, including recipient-paid transaction fees and new-account rent. Fee allocation and trade-fee logic tests pass. | A fresh operations payment and new trade-fee transfer were not executed. Expired-airdrop remainder withdrawal was not exercised; the claim window is not active. |
| Coin holder | Allocation, Merkle, history, scheduler, minimum and finalized-delta tests pass with mocked chain data. Live holder allocation is 0.001497327 SOL, unpaid, with an indexing schedule. | Cutoff October 1, 2026 at 00:00 UTC; target payout 01:00 UTC (08:00 Bangkok). This is a target, not a guaranteed payout; amounts under 0.01 SOL roll forward. |
| $FUNDED holder / community airdrop | Exact-migration-slot proofs, exclusion and complete-supply rules pass in deterministic fixtures. Live reserve API verifies 30,000,000 FCQA tokens funded. Browser shows verified reserve and disabled “Opens after snapshot”. | Live claim policy is not activated. Migration snapshot, published proof and payable claim state are unavailable. No live token claim or expiry sweep tested. |
| X account | Real app readiness is true; unauthenticated claim list returns 401. Mocked OAuth HTTP tests cover browser-bound PKCE, restart, CSRF, wallet binding, attestation, old signatures and uncertain state. | Real X login and payout were not performed. Current registered coin allocates 0% to X and has no eligible X reward. |
| Referral | Browser connected an in-memory Ed25519 wallet and signed registration; isolated ledger persisted the verified code. HTTP tests cover claim verification and disabled execution. Two existing finalized live payments total 0.000299465 SOL. Live paid replay returned the original receipt and left claim state unchanged. | Fresh live referral payout was not executed. Second/third levels lack live recipients; their policy and graph behavior are covered locally. |
| Buyback / burn | Local fee allocation and live queue inspected. | 149,733 lamports accumulating; no finalized buyback/burn receipt. This is an allocation, not a holder claim. |

All 20 existing targeted scripts passed. The additional creator HTTP scenario and live referral paid-replay verification also passed. Contract-source checks are not Rust compilation or an independent security audit.

## Live chain evidence

The official RPC returned Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. The configured fee-router program `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik` and shared PDA `Dzs5c17shnJkSoQnRL7fDbjD4eAFnoh6dpzgHhfV1cmW` passed account-owner/header/policy verification.

Six existing payout transactions were fetched at finalized commitment with successful metadata and recipient balance changes. Creator and operations recipients also paid transaction fees and account rent; adding those costs reconciles their recorded gross payments. Referral recipient deltas match directly. These are freshly checked historical receipts, not transactions produced by this audit. Full signatures, slots and per-account deltas are in `../audit-records/claim-audit-20260929/chain-receipts.json`.

A single 0.1 SOL faucet request for an in-memory ephemeral wallet failed with RPC “Internal error”. No retry storm or alternate real wallet was used.

## Findings

1. **Local claim-origin limitation:** the Docker deployment rejects creator claim preparation from `http://127.0.0.1:8788` with 403 “Claim from the app origin.” Its configured `https://funded.vip` origin reaches the correct 409/zero-claimable response. The local Docker URL is suitable for inspection, but its creator claim flow is not enabled for localhost. Do not weaken origin validation to bypass this.
2. **Inconsistent funding copy:** Rewards → Holder says vault funding remains unverified, while Airdrops and `/api/airdrops/reserves` correctly show the FCQA reserve verified. The static copy is in `automatic-rewards-ui.js:28-29`.
3. **Payout precision:** X partner → Payment history displays the real 356-lamport referral payment as `0.000000 SOL`. The formatter at `app.js:1970` rounds to six decimals. The transfer is nonzero and the receipt is valid.
4. **Unrelated quote outage:** `/api/market/sol-usd` returned 503 and the token page displayed “SOL/USD quote unavailable.” Claim accounting remains denominated in SOL.

No application source changes, deployment, or database reset was performed. Added files are audit helpers and evidence only. The synthetic creator fixture must not be treated as an on-chain launch.

## Reproducibility and artifacts

- `../audit-records/claim-audit-20260929/tests.json`: names, exit codes, durations and output of the 20 scripts.
- `../audit-records/claim-audit-20260929/creator-http.json`: synthetic creator HTTP transitions.
- `../audit-records/claim-audit-20260929/running-devnet-api.json`: live API snapshot.
- `../audit-records/claim-audit-20260929/fee-activity.json`: live FCQA allocation and claim overview.
- `../audit-records/claim-audit-20260929/chain-receipts.json`: independently fetched finalized transaction evidence.
- `../tmp/claim-audit-20260929.mjs`: isolated environment and test runner.
- `../tmp/creator-http-audit-20260929.mjs`: isolated creator signing/HTTP test.
- `../tmp/claim-receipt-audit-20260929.mjs`: historical receipt reconciliation.

Browser coverage included Rewards overview/creator/holder/X tabs, token detail claim gates, Referral disconnected and synthetic-connected states, signed referral registration, Airdrops reserve display and Claimable filter. Real wallet-extension approval, real X consent, fresh funded claims, mobile claim approval, claim expiry sweeps and future scheduled payouts remain unverified.
