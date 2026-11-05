# Devnet release verification - 2026-11-05

This report separates finalized Devnet evidence from local mocked browser tests. Mainnet writes remain disabled. The platform fee remains 100 bps on buys and sells; the creator launch buy remains capped at 20% of supply.

## Finalized live flows

The process-memory-only QA wallet is `7eiBDd1zUyjNk8kNW3vRCqSoxg2tCHu4XM7CKDFq4m4o`. It received 5 Devnet SOL. No private key was saved. The public test coin is [CSdurwUSZKtipTsodqsibHtFdJTQTYfEmj6ckAejj1M](https://funded.vip/token/CSdurwUSZKtipTsodqsibHtFdJTQTYfEmj6ckAejj1M).

[Machine-readable public receipts and state observations](evidence/devnet-release-2026-11-05.json) contain the signatures and slots. Every claimed transaction was checked at finalized commitment with no execution error; amounts below were checked against recipient or token balance changes.

| Flow | Verified result |
| --- | --- |
| Metadata | Published content-addressed metadata and image matched the submitted public bytes. |
| Launch and registration | Protected V3 launch finalized; registration verified on chain and appeared once in the public registry. The launch service fee was 20,000,000 lamports. |
| Creator cap and custody | Exactly 200,000,000 tokens, 20% of supply, entered the developer escrow; creator loose inventory was zero before later trades. |
| Community reserve | Exactly 30,000,000 tokens entered the community vault atomically with launch. |
| Premature escrow release | Simulation rejected early release with custom error 6000; vault balance remained unchanged. This is rejection evidence, not a successful release. |
| Curve buy and sell | App fee recipient deltas were 30,000 and 29,406 lamports, exactly the rounded 1% fees; round-trip loose token inventory returned to zero. |
| Boost | 10x boost payment finalized for 519,140,011 lamports. Confirming the same receipt again did not duplicate the multiplier. |
| Included listing | A paid listing quote for the already-included funded.vip launch returned HTTP 409 with `included:true`, preventing duplicate charging. |
| Automatic collection | Router received exactly 10,956,454 lamports from the finalized collection. Six additional bounded Devnet trade pairs generated the normal collection threshold. |
| Settlement and creator payout | Settlement transaction finalized. Creator received exactly 7,669,517 lamports. All eight derived settlement vault deltas matched the allocation exactly after separating each newly initialized vault's 650,240-lamport rent reserve. Their allocations summed to the 10,956,454-lamport collection. |
| Curve completion | Remaining 563,100,000 tokens were bought; real token reserves became zero and `complete` became true. The app fee recipient received 7,758,853 lamports. |
| PumpSwap migration | A separate migration transaction finalized. Canonical pool `KLCrcnYB2WxQNWzghyNLE49nEWuvpnE9AnJUQbig8Tn` had positive token and SOL reserves and the expected creator router. |
| Post-migration app trades | The app selected its graduated-pool route for buy and sell. Fee recipient deltas were 30,000 and 30,574 lamports; the round trip restored the pre-trade token balance. |

## Fixes and verification scope

A failed creator-fee read for one mint previously aborted the rest of a collector scan. The collector now records that mint's error and continues later candidates. It retains uncertain transaction guards and stops admitting work during shutdown. The 13 focused collector/minimum/lifecycle regression tests passed. Concurrent worker health-file writers use distinct temporary paths, avoiding a rename race. Token controls now reveal themselves when a fixed verification notice covers keyboard focus. Explore keeps its live status current while retaining a focused card during a failed refresh. The desktop airdrop claim action now has a 44-pixel minimum height.

The complete unit baseline passed 1,825 tests, with 21 skips and no failures. PostgreSQL and Redis integrations were exercised separately earlier in this preparation task. The full browser baseline completed 1,053 cases: 818 passed, 231 failed and 4 skipped. Many failures referenced retired Home controls or navigation; this baseline is not a clean browser acceptance result. The focused 533-case rerun passed 451, failed 81 and skipped 1. Subsequent failure-only runs reduced the failures to zero; the complete 46-case token-control, compact-card and shared-card regression then passed. The 20 final focused collector/lifecycle/feature-view unit tests also passed. Source syntax (1,569 JS files) and size budgets (1,802 maintained code files) passed. These results precede integration of the separate reward/docs release published during verification; that combined candidate requires its own checks.

## Remaining verification gates

- Escrow matures **2026-11-06 01:22:24 UTC / 08:22:24 Bangkok**. Matured release cannot be claimed before that time. The 12-hour lock was not shortened.
- The holder pool recorded 1,095,646 lamports, below its ordinary $20 reference minimum. An automatic holder payment was not expected or demonstrated by this run.
- Operations payout and community funding were reported verified by the API; their recipient/vault deltas were not independently checked in this run.
- The ordinary daily bonus period had not closed. A complete daily winner/payment cycle is not established by these transactions.
- The buyback allocation was below the normal 5 SOL trigger. Buyback/burn execution, X claim, referral-upline payment, and a migration-time community claim remain outside this fresh receipt set.
- The already-included listing guard was checked; a new external paid listing and optional launch-tier burns were not repeated with this wallet. A read-only quote for 2.5 Devnet SOL returned about 167.87 $FUNDED, below the 263-token listing burn at that observation; the wallet had about 3.499 SOL left. No purchase or listing burn was submitted.
- No independent contract/custody audit or dedicated Mainnet deployment inventory has been supplied. Devnet success does not clear those Mainnet requirements.
