# Reward receipt cleanup and bitmap cycles — Devnet, 2026-11-19

The Devnet contract and app at https://funded.vip were deployed at revision `3a910ab01a2cc583557a8c1822cd594b4fc4b4eb`. A concurrent release subsequently deployed `859fc5898cdfc9fd8878e71ce05735eb9c1d2808`, with identical production payout code and changes only to tests and verification metadata. All six services passed acceptance with full signer enforcement (`all`). Mainnet activation remains blocked.

Completed legacy reward cycles retain their cycle account permanently. Once every payment has an archived finalized transaction with verified balance deltas, the worker closes at most four app-funded receipt accounts per pass and refunds their rent to the app authority. It first permanently completes the cycle, so closing receipts cannot make its leaves payable again. Incomplete or unverifiable cycles wait for reconciliation. Cleanup failures retain the archive and retry after a bounded delay.

New automatic holder/community reward schedules and daily-bonus cycles use a bitmap on Devnet. Each leaf has one persistent paid bit, bound to its index and Merkle proof. Setting the bit, accounting for the payment and transferring funds happen atomically. The bitmap cycle has a distinct account discriminator at the same cycle address, preventing a legacy payout handler or a second cycle from bypassing its paid state. Existing cycles retain their original format.

Manual creator, referral and X claims remain immediate and app-paid, without another wallet signature or OTP. There is no batching wait for these claims. Admin withdrawals retain their OTP flow.

## Live rent and fee measurements

Each case paid four disposable recipients 10,000 base units each. Every payout finalized with the exact full recipient credit and vault debit, one app signer/fee payer, and no recipient transaction fee.

| Asset | Transactions: individual → bitmap batch | Transaction fees: lamports | Individual receipt rent: lamports |
|---|---:|---:|---:|
| SOL | 4 → 1 | 20,000 → 5,000 (75% less) | 4,632,960 → 0 |
| SPL token | 4 → 1 | 20,000 → 5,000 (75% less) | 4,632,960 → 0 |

The legacy cycle held 1,534,160 lamports of rent; the bitmap cycle held 1,559,560. The extra five bytes cost 25,400 lamports, leaving **4,607,560 lamports saved per four-recipient cycle** after that overhead. This eliminates 99.45% of the former receipt-rent budget, or reduces total cycle-plus-receipt rent from 6,167,120 to 1,559,560 lamports (74.71%). These are measured Devnet values, not a Mainnet rent quote; savings vary with leaf count and transaction size. Token-account creation and other setup costs are separate.

Legacy cleanup refunded 4,632,960 lamports for each asset's four receipts, with a 5,000-lamport cleanup fee: 9,265,920 lamports reclaimed in total, net 9,255,920. Both closed cycles remained on-chain. Both archived legacy payments and bitmap payments were recovered from finalized transaction history. Repeated scheduler passes submitted zero payments. All four deliberate replay attempts—legacy after cleanup and bitmap, for SOL and SPL—finalized with an instruction error and unchanged vault balances.

The successful final run refunded all five disposable wallets to zero and burned/closed recipient token accounts. Fixture mint, vault and permanent cycle accounts retain setup deposits; those are not counted as reclaimed receipt rent.

A separate RPC independently verified all ten successful payout transactions, both cleanup transactions and all four failed replays, including exact balance changes and the retained cycle state. Every payout message digest matches an approved signer-journal entry under full enforcement, with no policy violations.

## Deployment and validation

The upgrade finalized at slot `523963000`. The deployed ELF is 1,167,656 bytes with SHA-256 `eece07be313e1a93f5eaacac0531f5495db3dceeaa067a036fcbabe34d78cb42`. Its full ProgramData commitment, including the retained deployment header and capacity, is `9a17e6fc6a9077566362f71ab2e12e8cef34ae9a4a6dcce87d548a03c2ec8a88`. App and signer pins match it. The upgrade retained the authority and refunded 5,932,571,320 lamports of upload-buffer rent, less its 5,000-lamport transaction fee.

- 113 targeted Node checks passed, including creator/referral/X claim regressions and payout reconciliation.
- The immutable release image passed 19 targeted tests, syntax/source checks and the production build.
- Eight compiled Devnet SBF tests passed, covering receipt closure, replay rejection, forged proofs, transaction rollback, token custody and expiry.
- Four compiled Mainnet SBF checks passed, including rejection of all seven new cleanup/bitmap instructions. These instructions are excluded from the Mainnet build.
- Public Devnet browser smoke passed 34 checks; two wallet-dependent cases were skipped.

The first live attempt encountered an optional evidence-provider 429 before vault setup; all five disposable wallets were refunded to zero. The subsequent isolated verification used the primary RPC for program evidence, with a separate provider checking finalized transactions independently. This was a verification-process setting; the deployed evidence configuration was not changed.

A preliminary SOL run completed both payout modes and receipt cleanup, then the RPC confirmation subscription threw the expected bitmap replay error. The harness now checks the finalized failed transaction even when confirmation throws. All five wallets from that run were refunded. A concurrent deployment terminated the next run's app container, losing its in-memory QA keys; 34,010,000 lamports (0.03401 Devnet SOL) remain in those five disposable wallets and cannot be refunded with the lost keys. No real-user or Mainnet wallets were used. A following signer-restart attempt refunded all five wallets. Final verification runs in a separate temporary container using the accepted image, with the deployment lock held during the test to prevent another release interruption.

## Operational limits and Mainnet blockers

Cycle accounts and their paid bits are intentionally permanent. Their rent, token-account creation and other setup deposits remain costs. Cleanup only reclaims eligible legacy receipt rent. The live fixture uses SOL and standard SPL-token rewards with an in-memory ledger; it does not create real-user entitlements or establish that authenticated X OAuth claims passed. Daily-bonus integration is covered locally.

The optional evidence RPC still needs operational attention for rate limits. Keep enough app balance for transaction fees and account rent, and monitor reconciliation/cleanup backlogs. Once bitmap cycles exist, a rollback to pre-bitmap contract bytecode would strand those cycles. Recovery must retain bitmap support, generally through a compatible forward fix; an app rollback alone does not revert the contract.

Mainnet remains **NO-GO**. The production program identity, mint/pool, authority and exact reviewed release bytes are unset in `config/mainnet-program-release.json`. The separate Mainnet signer review is incomplete and explicitly activation-blocked. Mainnet requires its reviewed network-specific payout integration, production-threshold acceptance, authenticated claim/admin checks, restore and RPC-failure drills, and a capped activation plan. Devnet success does not satisfy those gates. A read-only check confirmed the existing Mainnet containers retained their previous build and start times; this release made no Mainnet changes.

Public transaction receipts and measurements are recorded in [the JSON evidence](evidence/devnet-reward-rent-2026-11-19.json).
