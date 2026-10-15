# Devnet QA buyback minimum

The standard automatic V3 buyback trigger is **5 SOL** in verified, indexed
fee allocations. For disposable Devnet QA, the app can use a lower execution
gate while retaining the same on-chain 5% fee route and source proofs.

Set these server-only values in the deployment environment:

```dotenv
FUNDED_DEVNET_QA_MINIMUMS_ENABLED=true
FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS=10000000
```

The QA value must be between 10,000,000 and 100,000,000 lamports (0.01–0.1
SOL). The app refuses the QA profile outside Devnet. Remove the flag or set it
to `false` to restore the 5 SOL gate for larger UAT. The public buyback API and
dashboard show the active threshold; the worker reads the API rather than a
separate local value.

The lower gate only allows an attempt. The app still requires matching finalized
V3 launch, collection, settlement, vault balance, approved program hash, and a
protected market quote. A successful buyback still needs a finalized burn proof
and the expected vault and token supply changes before it counts as verified.
