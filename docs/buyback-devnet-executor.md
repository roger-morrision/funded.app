# Fee-funded buyback executor: Devnet evidence

The Devnet worker selects only settled, mint-verified creator-fee collections under an onchain-verified launch policy. It checks the pinned mint-router bytecode, source router header and spendable balance, the configured $FUNDED mint, and the verified SOL PumpSwap pool. The fee-router payout, protected buy, and SPL `BurnChecked` are signed by separate authority/operator wallets in one versioned Solana transaction. It persists the signed transaction and deterministic claim ID before broadcast. A completed receipt requires a finalized claim record, exact router debit, exact $FUNDED supply reduction, and an independently verified refund of unused swap input to the source router.

The worker is enabled only by `compose.buyback-worker.yml` with `SOLANA_CLUSTER=devnet`. Its dedicated Devnet operator key is mounted from an ignored local secret file. The address lookup table is configured in ignored `.env.deploy`. The public receipt index is `/api/buyback/status`; the buyback page reads that index, not browser-local preview records.

## Finalized checks on 2026-09-29

| Source launch mint | Router payout | Returned | Net fee-funded input | $FUNDED burned (base units) | Atomic buy + burn | Refund |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `GnWAfDUXzQYayqpsc2qZnrYBtuaPN42CjrXuD9AWzwjB` | 355 lamports | 4 lamports | 351 lamports | 340,173 | [`4MEDE4…`](https://explorer.solana.com/tx/4MEDE4Yztp4J4PvaGxEkV7iXs7Wzb2u4jzi8hYU819wLJne8Nb1di3QosVGYBTfGMJmBkMxquLgzcoUQcTKjyEes?cluster=devnet) | [`28SWYJ…`](https://explorer.solana.com/tx/28SWYJVmsGsXtEYg362Asvun6eAwYuMpvN6PLaHr9zKaoCNPZnsQypfFHXeqVrc9x2iuraL69QhdFfFUxwwVWDwK?cluster=devnet) |
| `7QYn6EnJWVkEZK9E4Qe8KAVqPX1xKQSuiKMKd1dE7rSg` | 1,477 lamports | 15 lamports | 1,462 lamports | 1,420,467 | [`3S6ZXH…`](https://explorer.solana.com/tx/3S6ZXHo5EH1uemFwXXqfEGsKUpaa4uWVpws84biAQQNKrRyzXLCJVN9q5yBRZyPUA1ZVhSDAqsW7kihVJsdiwyH9?cluster=devnet) | [`65u1Wg…`](https://explorer.solana.com/tx/65u1Wgqwvkjwb9bxfHnHdNW9AyDXHuPFB11JbUqKpFGSyosJks4t94iRBXDbsxpf4rTTJYHkHLZhw9ZzrTXv52F2?cluster=devnet) |

`npm run verify:buyback-devnet-receipts` independently checks finalized transaction metadata, exact source-router debits and refunds, mint claim records, the `BurnChecked` amounts, the pool's token debit, and the executor's zero net token balance. The two transactions reduced recorded $FUNDED supply by exactly 1,760,640 base units. The remaining 6 and 23 lamports are held by their respective source routers as rounding residue, awaiting another accrual.

## Mainnet gate

This Devnet executor uses the per-mint fee-router PDA until execution, then briefly uses a signer wallet for the swap and burn. It does **not** satisfy the published Mainnet requirement for a dedicated buyback PDA with no general withdrawal path. Keep Mainnet buyback readiness false until that custody program, its independent audit, permissionless execution, and public receipt indexing are complete. Devnet transaction fees and one-time account rent are paid by the disposable operator wallet, separate from creator-fee allocations.
