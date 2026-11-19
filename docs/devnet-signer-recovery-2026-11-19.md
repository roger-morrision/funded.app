# Devnet signer and milestone recovery — November 19, 2026

Deployed revision 884cb4a5a899856382307b3a8108e8e7bf48f1f1 to https://funded.vip. All six release services passed acceptance on image sha256:28343997ee0a9bce2ed26d6dbbeb2e4febf369a9769572af39eb73f3c0968c53. Mainnet (https://richpad.fun) was unchanged: agency execution and price signing remain disabled.

## Live results

- Before deployment, nine recorded milestone executions were finalized. One signed attempt was stuck: its signature and immutable receipt were absent, its blockhash had expired, and finalized height exceeded its validity window.
- The guarded executor retired that attempt with finalized expiry and receipt-absence evidence. It then prepared a replacement under the same immutable milestone intent.
- The independent signer released **47,118 lamports** from the expired unused reservation and reserved **47,118 lamports** for the replacement. Reloading the journal from disk preserved the release. The daily ceiling remained **2,000,000,000 lamports (2 SOL)**. The charged total remained 1,511,105 lamports because the released amount was reused.
- The replacement finalized at slot **523899194**, spent **47,118 lamports**, and burned **11,527.733308 tokens**. Vault debit, supply burn and immutable receipt matched. Both milestone completion bits are set.
- All **10 saved executions** now have finalized signatures and independently checked receipts with matching spend/burn amounts. Nine predated this deployment; one recovered during verification. No saved execution remains preparing or pending.

[Recovered Devnet transaction](https://explorer.solana.com/tx/4ztJqc6aL1x62EyHLPWe391dxdgmZ5F8DZneHCkavxiTSToLkjnCWjfbFiEb5gH3ZrJDGS79Qoaj4xYLA3kfoq4i?cluster=devnet)

[Machine-readable evidence](evidence/devnet-signer-recovery-2026-11-19.json)

## Validation and operational notes

The deployed image passed 50 regression tests, syntax validation for 1,180 JavaScript files and size checks for 1,370 maintained code files. Live verification used the existing Devnet worker and isolated signing services; no private keys were exported. The recovery calls used the normal guarded executor, without changing budgets, thresholds or immutable intents.

The prior release bundle and image are retained. A downgrade to its old signer requires an **offline journal compatibility step**: stop signing writers, back up the full current journal, and atomically retain every reservation row in a legacy-readable projection. Keep the original audit journal. Do not overwrite newer reservations with the pre-deployment snapshot. A scratch projection containing all 16 reservations loaded successfully in the prior image; the live journal was unchanged by this compatibility check.

Prepared Mainnet review material remains activation-blocked. Its review worksheet cannot enable the current Devnet-only signer.
