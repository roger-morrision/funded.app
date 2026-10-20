# Agency activation checkpoint — 2026-10-20

This log distinguishes reviewed source, local tests, and subsequent live execution. It is not an activation receipt.

## Baseline and incoming handoffs

The checkout and observed live app are `d6dcebf30da657c0f88abc12f52925a0035b0e70`. The intervening `9e6a76c`, `af84b7e`, `85ed313` and `d6dcebf` commits change skip-navigation behavior, airdrop focus preservation and Explore empty-state explanations. Git independently shows no financial or contract changes in those commits. Their improvements remain in this candidate.

QA reopened UX-008 because the first pointer activation of Clear all after editing Search can be lost. A separate worktree has a focused correction in progress; its report alone is not integration evidence. FQA-003 still lacks a natural late-funding correction outcome; paid rankings and prior receipts must stay immutable.

## Contract and budget preflight

The dedicated payer now has 16.303105476 Devnet SOL. The independently recalculated requirement is 8.8399198 SOL, including 4.886579 SOL refundable upload rent, 0.9233408 SOL program growth, a 0.03 SOL other-cost budget and the protected 3 SOL reserve.

Current contract source was rebuilt with platform-tools v1.54, Rust 1.89.0 and the `devnet-v3-program` feature. Its 961,760 bytes reproduce the reviewed SHA-256 `3ba48566fd36814d9b2e8c834b3544da68ab822309e8575826d33e7c87fda9d0`. All 22 Devnet-feature unit/VM tests passed with host Rust 1.97.1. This does not prove an upgrade or any new on-chain agency payout.

The app baseline has 1,048 passing unit tests and 10 existing skips. Exact runtime/image and final integration checks must be refreshed before publication.

## Isolated acceptance API

`FUNDED_API_ONLY=true` suppresses the API process's community index, holder scheduler and Daily bonus scheduler. It does not change fee policy, authorization, signing or readiness gates. Default startup retains all three workers; malformed values fail closed. This lets a local-only acceptance API use the primary worker's real shared readiness without duplicating background financial jobs. The acceptance listener must bind to localhost; public normal agency launch gates remain closed until reviewed acceptance.

Generated binaries, signer files, transaction journals and detailed proofs belong in ignored evidence directories, not commits. The approved future-mint protocol allocation remains Operations 8%, referrals 1% (0.6/0.25/0.15% of gross), agency 2%, Daily bonus 4%, and FUNDED buyback 5%, with creator-directed 80%. Existing mint policies must not be repriced.
