# Devnet full signer enforcement — 2026-11-19

Enabled `FUNDED_SIGNER_ENFORCE=all` on the funded.vip internal signer. The accepted, frozen release persists this setting across container recreation. The only runtime configuration change was `treasury` → `all`; the tested image, program allowlist, treasury limits, and independent price signer limits were retained. No application rebuild was needed.

- Accepted release: `884cb4a5a899856382307b3a8108e8e7bf48f1f1-e65482b1-3317-4984-8455-5e6c3034870e`.
- Image: `sha256:28343997ee0a9bce2ed26d6dbbeb2e4febf369a9769572af39eb73f3c0968c53`.
- Source: `884cb4a5a899856382307b3a8108e8e7bf48f1f1`.
- All six release services were healthy at 06:44 UTC.

Future Devnet releases must preserve `services.signer.environment.FUNDED_SIGNER_ENFORCE: all`. The previous release is available for rollback, but its `treasury` setting restores observation-only behavior for non-treasury roles. Runtime bundles and credentials remain outside Git.

## Verified behavior

The live signer returned HTTP 403 for unapproved programs requested through each non-treasury role: keeper, authority, and legacyAuthority. These negative probes were never broadcast. Existing signer tests passed 5/5, including allowed legacy/v0/partial transactions, prohibited authority changes and loaders, treasury restrictions, and observation-mode behavior.

A fresh Devnet fee cycle used an in-memory ephemeral wallet to buy and sell an existing QA token. Its token account was closed, its remaining SOL returned, and its final SOL balance was zero. No private key was persisted. Existing QA minimums were retained.

The normal collector collected 355,839 lamports. Normal authenticated settlement/disbursement API paths then finalized the following allocations. Independent finalized RPC reads verified matching recipient credits and category-vault debits:

| Flow | Lamports | Finalized slot |
|---|---:|---:|
| Creator reward funding | 142,336 | 523904178 |
| Community funding | 14,233 | 523904213 |
| Operations payout | 28,467 | 523904244 |
| RICH buyback and burn | 17,793 | 523904429 |

The regular buyback worker consumed the eligible allocation and burned 1,459 RICH base units. Verification matched its finalized transaction, vault debit, SPL burn instruction, immutable program-owned receipt, and independent price-signer reservation. Every payout/buyback transaction message matched a successful internal-signer journal entry with no policy violations. The price signer retained its shared 2 SOL/day cap.

Buyback transaction: [Devnet explorer](https://explorer.solana.com/tx/5ekfg8CKaJifpBxyziG8Aqyp3AcyYh8Rr8zDfbnTZK7yTM1GNWvzv4cdV2z6xZhWndSGPYAs8HQb3iXkuERDAUkJ?cluster=devnet).

A concurrent settlement worker received a state-change 409 while the verification request completed that settlement. No duplicate settlement was submitted; subsequent worker cycles were ready with zero errors. Final collection, settlement, disbursement, and buyback queues were empty.

## Scope and Mainnet

Live payout coverage is automatic reward/community funding and operations payout. Manual creator/referral claims and treasury withdrawals were not executed. The live buyback is the normal RICH category-6 path; completed own-coin milestones were not reset. “Full” means all existing signer policy violations now block signing; it does not add new recipient restrictions or payout caps.

Mainnet activation remains blocked. Read-only checks confirmed the Mainnet app and RPC gateway retained build `18d15d6daa1f64a30e4870d627d6d44ede580d4d` and their original start times, with no enabled agency-buyback flags or configured price signer. No Mainnet deployment or transaction was performed.

Machine-readable public evidence, including transaction signatures and matching signer entries: [evidence](evidence/devnet-full-signer-enforcement-2026-11-19.json).
