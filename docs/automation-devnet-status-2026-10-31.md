# Devnet automation delivery status — 2026-10-31

Status: source and app services updated; on-chain program upgrade and live end-to-end acceptance blocked by RPC availability.

## Delivered

- Local source commit `181eb1588dfc080b2253620bc1210028fd160971` adds automatic collection/settlement processing and bounded disbursements for protected and agency mint policies. Each mint has immutable operations/referral destinations. Existing creator-share caps, reward-vault checks, category budgets and one-time receipts still apply.
- App, fee collector, buyback worker and agency buyback worker run `fundedapp-devnet:automation-181eb15`. Image digest: `sha256:0d98be40a4fe7a8271960688755ec7a50370af45886552c6764bd06cde810a6e`.
- The app reports the exact source revision, runs as UID 1000 with read-only source, and returns HTTP 200 for health. New financial paths and launches are paused pending the program upgrade. The generic signer-disabled image acceptance helper is not a passing check for this financial deployment.
- Archived 20 existing Devnet launches. Active launch listing count is zero. All 40 collection records remain. Backup and exact mint manifest are in the existing data volume under `/app/data/automatic-rewards/archives/automation-20261031`. Pre-archive state SHA-256: `c94bc137fbeb8403c889203bdd925e8908a240773cac43571a680751bbb4fc0d`.

## Contract evidence

- Target program: `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm` on verified Solana Devnet.
- Upgrade authority: `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`.
- Candidate: `contracts/funded-fee-router/target/automation-candidate/funded_fee_router.so`, 1,051,848 bytes.
- Candidate SHA-256: `b4189944394dceddbf6c9d116957a5f6185d81a7257f377166e80d1a65388e0e`.
- All 29 Devnet-feature contract tests passed locally against this exact SBF candidate. Additional protected-policy assertions passed for immutable operations recipients, authority-only payment and replay rejection. Focused JavaScript route/proof suites, archive checks, web build and Docker build passed. These are local validations, not live Devnet end-to-end acceptance.

## Upload state and blocker

The configured transaction and holder RPC providers report exhausted usage. The public Devnet RPC repeatedly returns HTTP 429, including connection limits during sequential writes. CLI upload retries were stopped and their state reconciled. No concurrent upgrade process remains.

The program allocation extended to 1,051,848 bytes, but its previous code prefix was verified unchanged. The last reconciled extended ProgramData SHA-256 was `9886a726285c71398fe033d76b7df6c1f2ad1ed8b3d7eacb59abbc192eb21506`. The new binary is not confirmed deployed.

Existing buffer `3HyhzGr11oRbb1cyJfWkRAmopKWCveKzuevTUjHxYiqq` remains owned by the verified upgrade authority. Its last observed balance was 5.34426668 Devnet SOL. It can be resumed or closed by that authority. No second funded buffer was created. Original ProgramData, upload attempt metadata, confirmed write signatures and archive manifest are retained under ignored `tmp/automation-release/` storage. No signing secrets are included in these reports.

## Remaining acceptance

Restore the configured Devnet RPC quota or provide an available Devnet RPC. Reconcile the program and existing buffer first, upload only missing bytes, verify the complete finalized buffer, complete the upgrade, and verify every deployed byte and the full ProgramData hash. Then pin that hash, activate the automation gates and run the fresh disposable Pump launch/trade/collection/settlement/funding/payout/buyback script.

`scripts/run-automation-e2e-devnet.mjs` is prepared but has not run because deployment did not complete. Real Pump migration, holder eligibility periods, bonus ranking windows, OAuth-bound X identity and token-claim ownership each need their own acceptance evidence. Local fixtures do not establish those live flows. No claim of complete end-to-end on-chain coverage is made.
