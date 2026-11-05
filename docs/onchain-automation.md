# Devnet on-chain automation

Product workflows: [all-page guide](product-guide.md). Documentation scope and dated evidence: [index](README.md).

The keeper collects Pump creator fees, settles verified collections into saved-policy vaults, and releases eligible allocations without repeated creator signatures. `FUNDED_V3_AUTO_SETTLEMENT_ENABLED` and `FUNDED_V3_AUTO_DISBURSEMENT_ENABLED` activate these paths only after deployment of the tested program and verification of its finalized ProgramData hash.

The current router authority initializes one immutable `mint-automation-v3` PDA per mint. It binds the mint, creator, exact protected or agency policy, operations wallet, and three referral wallets frozen at the first qualified settlement. Missing referral wallets cannot receive automatic payments. Existing on-chain creator/holder/X share caps, reward-vault destination checks, category budgets, approval receipts, and withdrawal replay protection apply to every automatic release. The authority remains a trusted attestor of eligibility; this is not a permissionless entitlement oracle. Unprotected historical policies cannot enroll.

The collector service calls authenticated keeper routes. It preserves transactions with uncertain outcomes for reconciliation. It does not automatically retry recorded pending transfers. Recipient rent requirements, configured minimums, market checks, holder periods, daily ranking windows and proof checks still apply.

Token creation and discretionary trades require the initiating wallet signature. Creator fees and three-level referral rewards require manual recipient claims. X identity requires OAuth and its claim flow. Migration token airdrops are delivered automatically using exact-slot eligibility and immutable allocation proofs. Real Pump migration requires Pump's actual conditions. Tests using fabricated eligibility or migration fixtures must be labelled as fixtures. Signatures and HTTP responses alone do not prove payment: finalized transactions, policy receipts and exact balance changes are required.

The old Devnet app records and their October 31 backup archive were permanently deleted with explicit authorization. An address-only exclusion list prevents their reimport. Their Solana mints, balances and transaction history remain on-chain. See `devnet-record-deletion-2026-11-01.md`.

Server financial requests using the shared RPC connection share an HTTP pool and a 500 ms request budget, with historical block reads paced separately at 2.5 seconds. Only a tagged collection-readiness failure proven to precede transaction construction is automatically retryable. Signed or uncertain payouts retain their existing reconciliation guard. Receipt-only recovery verifies the exact finalized transaction, policy, withdrawal receipt, vault debit and recipient credit without resubmitting payment.

The November 1 [deployment and acceptance report](devnet-automation-release-2026-11-01.md) records the finalized program, exact service release, real payment proofs, restored standard policies and remaining live acceptance limits.

The subsequent [shared RPC gateway release](rpc-gateway.md) centralizes provider connections, read deduplication, atomic account batches and confirmation polling across the deployed app and workers. In gateway mode, the shared connection delegates pacing to that service so concurrent account reads can join one batch.
