# App service fees

| Service | Default | Payment |
| --- | --- | --- |
| Trading through funded.vip | 0.5% on buys and sells | SOL transfer included in the trade |
| Every coin launch, including Standard | 0.02 SOL | Atomic SOL transfer to the app service treasury |
| Optional Pro promotion | $150 | $FUNDED BurnChecked in the creation transaction, plus launch SOL fee |
| Optional Premier promotion | $300 | $FUNDED BurnChecked in the creation transaction, plus launch SOL fee |
| External coin listing | $300 | Quoted $FUNDED BurnChecked bound to the listing mint |
| Listing for a verified funded.vip launch | Included | No additional listing burn |

## Quote and payment rules

The admin service-fee editor persists versioned prices with a signed administrator session, same-origin writes, revision/hash conflict detection, and an audit reason. Changes apply to newly issued quotes. Launch and burn quotes are valid for ten minutes; a submitted transaction is checked against the original saved quote and its confirmation time, including when recovering a receipt after a later price change. Existing receipts are not repriced.

The browser loads the current policy before preparing a trade or launch. Trading fees are charged on both sides using exact lamport rounding and are shown in the review. The launch estimator simulates the complete transaction including its service transfer; the budget breaks out the launch service fee, reserve/developer purchase, rent, network fees and purchase allowance. A changed or expired launch quote requires another review before signing.

The API registers a new launch only after finalized Pump creation, immutable V3 policy, atomic community reserve, any promotion burn, and the exact service payment are verified. A fee transfer made in a different transaction does not satisfy the atomic launch fee. A failed creation transaction rolls back its service transfer. If router setup is a separate earlier transaction, its network/rent costs can remain even when creation fails.

Launch service quotes are persisted in the file and PostgreSQL stores. The quote endpoint reads its write back before permitting payment preparation; a storage failure returns an unavailable response before signing. The Devnet fee-flow verification and its recovery evidence are recorded in [the QA report](service-fees-qa-2026-10-19.md).

External listings require verified mint metadata, a saved USD/token quote, and a finalized matching burn. A burn cannot be reused for another listing. Verified funded.vip launches are already in the launch directory and are excluded from paid listing quotes. Older confirmed receipts retain their original USD value in history.

## Accounting and disclosure

App trading and launch fees are service charges. $FUNDED promotion/listing payments are token burns. These are separate from Pump/pool trading fees and from the 80/20 split of creator fees actually collected by each mint router. Network costs, account rent, reserve purchases, price impact, and slippage are shown separately where relevant. Admin prices do not change Pump contracts or the fee policy of an existing mint.

The proposed AI agency 2% allocation remains an unactivated candidate. Raising service prices does not activate that contract budget or its executors.
