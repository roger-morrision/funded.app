# Agency activation checkpoint — 2026-10-20

This log distinguishes reviewed source, local tests, and subsequent live execution. It is not an activation receipt.

## Baseline and incoming handoffs

The checkout and observed live app are `d6dcebf30da657c0f88abc12f52925a0035b0e70`. The intervening `9e6a76c`, `af84b7e`, `85ed313` and `d6dcebf` commits change skip-navigation behavior, airdrop focus preservation and Explore empty-state explanations. Git independently shows no financial or contract changes in those commits. Their improvements remain in this candidate.

QA reopened UX-008 because the first pointer activation of Clear all after editing Search can be lost. A separate worktree has a focused correction in progress; its report alone is not integration evidence. FQA-003 still lacks a natural late-funding correction outcome; paid rankings and prior receipts must stay immutable.

The completed UX-008 source commit `999c8eee84d9aefced7d8ea41fcadd7074425c55` was inspected, cherry-picked as `3c96e72`, and its three file contents compared independently with the source. Merge `acbba9be33f58b51cf9b315b16ea2093c7b7a3f0` subsequently includes the remote commit as well as the API worker-role changes. All 1,050 unit tests passed (10 skips), 18 production-image browser fixture cases passed, and production build, source checks and five critical gates passed. These browser cases mock APIs and do not prove payments.

## Contract and budget preflight

The dedicated payer now has 16.303105476 Devnet SOL. The independently recalculated requirement is 8.8399198 SOL, including 4.886579 SOL refundable upload rent, 0.9233408 SOL program growth, a 0.03 SOL other-cost budget and the protected 3 SOL reserve.

Current contract source was rebuilt with platform-tools v1.54, Rust 1.89.0 and the `devnet-v3-program` feature. Its 961,760 bytes reproduce the reviewed SHA-256 `3ba48566fd36814d9b2e8c834b3544da68ab822309e8575826d33e7c87fda9d0`. All 22 Devnet-feature unit/VM tests passed with host Rust 1.97.1. This does not prove an upgrade or any new on-chain agency payout.

The app baseline has 1,048 passing unit tests and 10 existing skips. Exact runtime/image and final integration checks must be refreshed before publication.

## Isolated acceptance API

`FUNDED_API_ONLY=true` suppresses the API process's community index, holder scheduler and Daily bonus scheduler. It does not change fee policy, authorization, signing or readiness gates. Default startup retains all three workers; malformed values fail closed. This lets a local-only acceptance API use the primary worker's real shared readiness without duplicating background financial jobs. The acceptance listener must bind to localhost; public normal agency launch gates remain closed until reviewed acceptance.

Generated binaries, signer files, transaction journals and detailed proofs belong in ignored evidence directories, not commits. The approved future-mint protocol allocation remains Operations 8%, referrals 1% (0.6/0.25/0.15% of gross), agency 2%, Daily bonus 4%, and FUNDED buyback 5%, with creator-directed 80%. Existing mint policies must not be repriced.

## Finalized Devnet upgrade and configuration

After a graceful stop and confirmed `reward_ledger_drained`, the reviewed binary was upgraded on program `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`:

- Upgrade: [3EXLJngj…GdzK4](https://explorer.solana.com/tx/3EXLJngjUG59hDAU8f5VhpjR1oo3AKT1raX3hb2sgznCXBhL3amYp4LVnwG1J8AMFQwfATAPhJUfmJTaGytGdzK4?cluster=devnet), finalized slot 513006755.
- Complete ProgramData SHA-256: `c5336c8859b180e1ceb062bcdce016813dd76b23dced5f1521bfa88449df1961`. Executable bytes reproduce the reviewed binary commitment above; upgrade authority remains the approved QA authority.
- Upload buffer closure/refund verified. Net payer debit was 0.9281158 SOL, within program-growth rent plus the 0.03 SOL cost budget. Payer retained 15.374989676 SOL before the configuration transaction, above the protected 3 SOL reserve.
- Configuration revision 1: [3hnkDKZ2…h8fFE](https://explorer.solana.com/tx/3hnkDKZ2mLhe1bUmU9qxecHkNsnAzDAejgohzkaJrkrZmAoocTpnMCKPDrVWw53Z6pQz4KP9Fd27Ua91Ac2h8fFE?cluster=devnet), finalized slot 513006803. Exact gross units are `[800000,60000,25000,15000,400000,500000,200000]` out of 10,000,000, with the fixed creator-directed 8,000,000 units separate.
- The wallet-authenticated admin publisher independently verified the finalized authority-signed instruction and published policy revision 3. All 15 existing launch policy/distribution records were unchanged. Public referral overview and FAQ visibly show 0.6% / 0.25% / 0.15%.

Ignored evidence: `tmp/agency-upgrade-finalized-proof-20261020.json`, `tmp/agency-config-20261020.json`, `tmp/agency-policy-publication-20261020.json`, and `tmp/agency-activation-runtime-20261020.json`.

## Remaining acceptance gates

The dedicated agency worker verifies the new binary, authority, configuration and active lookup table. Its actual X account verification fails with HTTP 401 / provider code 32. All four publisher secret mounts match the existing X worker; X's response time matches the container clock. No X post, promotion billing, fresh agency launch or new-rate referral payout is claimed from this run. Publishing credentials must be refreshed before those tests can proceed. Raw credentials and provider error bodies are never logged. The worker now records a sanitized reason code, exact build and program hash while retaining blocked readiness.

Public normal agency launch flows remain explicitly gated. Public health is operational and `/api/status` independently verifies all 34 recorded V3 settlements. Daily bonus indexing and payouts remain active under settlement-time windows. Inspection of all 577 saved bonus snapshots found no pending reconciliation or additive revision to execute; FQA-003's genuine late-evidence financial acceptance remains unverified. No artificial snapshot or transfer was created to close it.

Own-coin $100k/$300k agency buyback/burn milestones, fresh X publication/billing and referral payouts under the new eight-category policy remain unverified on the live application. Serialization and local VM tests are separate evidence. The unrelated FQA-009 verifier repair is being reviewed in its own worktree; its changes must be integrated and retested before claiming broad verifier coverage.
