# V3 fee-funded $FUNDED buyback and burn

## Current execution rule

The coin's saved buyback share of collected creator fees accrues in dedicated V3 program vaults. The current new-launch default is 5% of gross creator fees. Existing coins retain their recorded rates. It is not 5% of trade volume and does not buy back each launched coin.

The normal aggregate trigger is **5 SOL** of verified eligible allocations. A bounded Devnet QA profile can lower it; the API/dashboard displays the active value. Rent, holder/X obligations, unrelated funds and spent allocations are not eligible balances.

Execution requires the approved current program, finalized collection/settlement proofs, vault backing and a verified $FUNDED market quote/route. Quote age, liquidity, slippage and spend protections still apply after the trigger is met. Finalized purchase and burn receipts must prove the expected vault debit and token supply/account changes.

The Devnet executor also has a separate **10,000-lamport (0.00001 SOL) minimum per source order**. Smaller allocations remain in their program vaults and appear as `below-minimum-order`, rather than executable queued purchases. The worker skips these unsigned orders; transactions that already have a signature remain eligible for reconciliation. `/api/buyback/status` exposes the floor as `minimumOrderLamports`. This order floor does not change the aggregate trigger or mark retained funds as spent.

Home and Buy & burn show eligible SOL, trigger, last verified execution timestamp and transaction evidence. An allocation, queued order, full progress bar or historical burn under another code hash does not prove current execution. Mainnet is a separate reviewed release.

Sources: [worker policy](../server/v3-buyback-worker-policy.mjs), [quote](../server/v3-buyback-quote.mjs), [transaction](../server/v3-buyback-transaction.mjs), [proof](../server/v3-buyback-proof.mjs), [dashboard](../server/v3-buyback-dashboard.mjs), [QA minima](devnet-qa-minimums.md).

## Historical executor evidence

> **Retired V2 procedure.** The worker and Compose commands below describe an earlier implementation. They are historical evidence, not instructions or activation status for the current V3 executor above.

The Devnet worker selects only settled, mint-verified creator-fee collections under an onchain-verified launch policy. It checks the pinned mint-router bytecode, source router header and spendable balance, the configured $FUNDED mint, and the verified SOL PumpSwap pool. The fee-router payout, protected buy, and SPL `BurnChecked` are signed by separate authority/operator wallets in one versioned Solana transaction. It persists the signed transaction and deterministic claim ID before broadcast. A completed receipt requires a finalized claim record, exact router debit, exact $FUNDED supply reduction, and an independently verified refund of unused swap input to the source router.

The worker is enabled only by `compose.buyback-worker.yml` with `SOLANA_CLUSTER=devnet`. Its dedicated Devnet operator key is mounted from an ignored local secret file. The address lookup table is configured in ignored `.env.deploy`. The public receipt index is `/api/buyback/status`; the buyback page reads that index, not browser-local preview records.

## Finalized checks on 2026-09-29

| Source launch mint | Router payout | Returned | Net fee-funded input | $FUNDED burned (base units) | Atomic buy + burn | Refund |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `GnWAfDUXzQYayqpsc2qZnrYBtuaPN42CjrXuD9AWzwjB` | 355 lamports | 4 lamports | 351 lamports | 340,173 | [`4MEDE4…`](https://explorer.solana.com/tx/4MEDE4Yztp4J4PvaGxEkV7iXs7Wzb2u4jzi8hYU819wLJne8Nb1di3QosVGYBTfGMJmBkMxquLgzcoUQcTKjyEes?cluster=devnet) | [`28SWYJ…`](https://explorer.solana.com/tx/28SWYJVmsGsXtEYg362Asvun6eAwYuMpvN6PLaHr9zKaoCNPZnsQypfFHXeqVrc9x2iuraL69QhdFfFUxwwVWDwK?cluster=devnet) |
| `7QYn6EnJWVkEZK9E4Qe8KAVqPX1xKQSuiKMKd1dE7rSg` | 1,477 lamports | 15 lamports | 1,462 lamports | 1,420,467 | [`3S6ZXH…`](https://explorer.solana.com/tx/3S6ZXHo5EH1uemFwXXqfEGsKUpaa4uWVpws84biAQQNKrRyzXLCJVN9q5yBRZyPUA1ZVhSDAqsW7kihVJsdiwyH9?cluster=devnet) | [`65u1Wg…`](https://explorer.solana.com/tx/65u1Wgqwvkjwb9bxfHnHdNW9AyDXHuPFB11JbUqKpFGSyosJks4t94iRBXDbsxpf4rTTJYHkHLZhw9ZzrTXv52F2?cluster=devnet) |

`npm run verify:buyback-devnet-receipts` independently checks finalized transaction metadata, exact source-router debits and refunds, mint claim records, the `BurnChecked` amounts, the pool's token debit, and the executor's zero net token balance. The two transactions reduced recorded $FUNDED supply by exactly 1,760,640 base units. The remaining 6 and 23 lamports are held by their respective source routers as rounding residue, awaiting another accrual.

## Mainnet gate

The current V3 executor uses the program vault as the PumpSwap authority and burns through program CPI; the operator signs execution and pays transaction fees and one-time account rent separately. It does not temporarily transfer the buyback budget into the operator wallet. Devnet execution does not authorize Mainnet: keep Mainnet readiness false until the separate deployment, approved program bytes, audit, market route, execution permissions and receipt verification have been reviewed.
