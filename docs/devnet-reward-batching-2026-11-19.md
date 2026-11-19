# Bounded automatic payouts — Devnet, 2026-11-19

Deployed revision `9384ca0d01a05482d1aca03691018c4e5c6ae563` at https://funded.vip. All six release services passed acceptance. Full signer enforcement remains `all`; Mainnet activation and Mainnet batching remain blocked. No on-chain program upgrade was needed.

Scheduled holder rewards (SOL and tokens), reward-scheduler snapshot airdrops and daily bonuses use groups of at most four recipients. Every signed transaction fits within 1,200 serialized bytes and a 600,000-compute-unit ceiling. Simulation sizes the compute limit with 15% headroom. Oversized or simulation-failing groups split before signing. A send with an uncertain outcome is left for receipt reconciliation; it never triggers immediate fallback resubmission.

Manual creator, referral and X claims remain on their immediate single-recipient path, without a batching wait, extra wallet signature or OTP. The app remains the fee payer. The dedicated migration community-delivery journal and admin withdrawal flow were not changed.

## Live measurement

Four disposable recipients received 10,000 base units each in every comparison. These are real finalized Devnet payouts using the deployed scheduler and chain modules with an isolated in-memory fixture ledger. They are not fabricated app entitlements or proof of X OAuth functionality.

| Asset | Transactions: individual → batch | Fees in lamports | Fee reduction |
|---|---:|---:|---:|
| SOL | 4 → 1 | 20000 → 5000 | 75% |
| SPL token | 4 → 2 | 20000 → 10000 | 50% |

Every recipient received the exact full amount. Every payout transaction had one signer: the app authority, which also paid the fee. Each repeated scheduler pass submitted zero additional payments. The final release was checked again with the normal deployed evidence-provider configuration and compared with the earlier live individual-payment baseline. A separate RPC independently verified transaction status, signer, vault debit, recipient credit, receipt accounts, wire size and compute use. Signer-journal message digests match all payout transactions, with no policy violations.

**These percentages apply to transaction fees only.** Receipt rent was 4,632,960 lamports for four recipients in both modes. Token-account creation and cycle/setup deposits are separate costs. Batching preserves duplicate-payment receipts and does not eliminate their rent. Savings depend on proof size and how many recipients fit in a transaction.

All five disposable wallets in the baseline run and all ten wallets across the two final recheck runs were refunded to zero; recipient token accounts were burned/closed during cleanup. Private keys were held only in memory. Two earlier verification attempts hit evidence-provider rate limits; all five wallets in each were also refunded. The first final recheck completed SOL payouts before a token-setup rate limit; the token-only recheck then completed the remaining coverage. Their isolated program accounts retain rent and unused fixture vault funds. Successful baseline and final payout receipts, plus cleanup receipts for every attempt, are in the JSON evidence.

The final evidence commit adds documentation and harness options for batch-only/token-only checks. The deployed runtime remains the immutable revision identified above. The harness was streamed into that running image and imported its deployed payout modules.

## Validation and limits

- 108 targeted checks passed, including the existing creator/referral/X claim regressions, batching bounds, simulation splitting, ambiguous-send handling, duplicate recovery, token credits and aggregate daily-bonus proofs.
- The release image passed 14 batching checks, syntax checks for 1,059 files, source budgets for 1,252 files and the production build.
- Devnet browser smoke: 32 passed, 2 skipped, 2 failed on `/#list` because token logo/overview reads returned 404. Those listing paths are outside this change.
- The optional program-evidence provider throttled preliminary tests. Batch preparation now shares one readiness check across its bounded group, while checking again before each send and after confirmation. The verification harness backs off on transient provider errors.
- Live payout testing covered SOL and standard SPL-token reward cycles. Daily-bonus integration/proof compatibility and splitting/failure cases were checked locally; no real-user daily-bonus awards were fabricated for this test.

Evidence: [devnet-reward-batching-2026-11-19.json](evidence/devnet-reward-batching-2026-11-19.json).
