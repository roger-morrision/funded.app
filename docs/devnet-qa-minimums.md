# Devnet QA buyback minimum

The standard automatic V3 buyback trigger is **5 SOL** in verified, indexed
fee allocations. For disposable Devnet QA, the app can use a lower execution
gate while retaining the same on-chain 5% fee route and source proofs.

Set these server-only values in the deployment environment:

```dotenv
FUNDED_DEVNET_QA_MINIMUMS_ENABLED=true
FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS=5000000
```

The QA value must be between 5,000,000 and 100,000,000 lamports (0.005–0.1
SOL). The app refuses the QA profile outside Devnet. Remove the flag or set it
to `false` to restore the 5 SOL gate for larger UAT. The public buyback API and
dashboard show the active threshold; the worker reads the API rather than a
separate local value.

The lower gate only allows an attempt. The app still requires matching finalized
V3 launch, collection, settlement, vault balance, approved program hash, and a
protected market quote. A successful buyback still needs a finalized burn proof
and the expected vault and token supply changes before it counts as verified.

## Hourly holder QA policy

For one disposable Devnet mint, the same flag can lower the wallet holding,
funded pool, and lamport floor without shortening the hourly cadence:

```dotenv
FUNDED_DEVNET_QA_HOLDER_MINT=<disposable Devnet mint>
FUNDED_DEVNET_QA_HOLDER_MIN_USD=1
FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD=0.50
FUNDED_DEVNET_QA_HOLDER_MIN_LAMPORTS=1000000
FUNDED_DEVNET_QA_FEE_COLLECTION_MIN_LAMPORTS=5000000
```

The wallet minimum is a whole dollar amount from $1 to $19. The pool minimum
accepts $0.10–$19.99 in cents; the lamport floor is
1,000,000–9,999,999. They require a fresh verified quote, finalized sampled
holder balances, a funded vault, and all existing payout proofs. Existing
prepared manifests and paid cycles are retained. A policy change starts at the
next hourly boundary; available verified funding can carry forward. The policy
values are copied into the reward program and exposed with a QA label in the
holder directory. Remove the selected mint to return to the standard $20
wallet/pool and 0.01 SOL floor for new periods. Changing the application
minimums does not change the on-chain fee split.

The optional fee collector setting applies only to the selected Devnet mint.
It accepts 1,000,000–9,999,999 lamports; all other mints keep the 10,000,000
lamport collector floor. This only starts collection. A creator must still
finalize the V3 settlement and holder funding before the hourly reward
schedule can prepare a payout.

For a disposable five-minute payout test, set the same selected mint in
`FUNDED_QA_HOLDER_MINT` and set `FUNDED_QA_SHORT_REWARD_PERIODS=true`. This
retains its bounded Devnet holder and pool minimums, samples finalized holder
balances every minute, and starts at the next five-minute boundary. Unprepared
hourly periods are skipped while verified funding rolls into the first complete
five-minute period. Paid cycles remain immutable. Set the short-period flag to
`false` to restore hourly cadence at the next boundary for larger UAT.
