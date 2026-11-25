# Devnet program upgrade — 2026-11-25

Historical deployment snapshot: the live app was subsequently migrated to the configurable program. See [the configurable app and financial regression report](configurable-devnet-app-2026-11-25.md) for the newer release and live transaction checks.

The Devnet app at https://funded.vip runs release `334481307e3261d9ba8add50bd49264ef7eafd7e` with the latest compatible router/developer-escrow bytecode. All six app/worker/signer services use image `sha256:e5e5eb97e40d54f220ebf4b281b3f82475d30a54ebfbf68c9d2dc0f8f711d19b`; their health, public build identity, frontend program identity, signer allowlist and finalized on-chain commitment were verified together.

## Deployed programs

| Role | Program | ELF SHA-256 | Finalized upgrade slot |
| --- | --- | --- | --- |
| Live app | `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm` | `8846d6e61644db50a941b11a8dafc9b6eb6da5c91578f6a116605ff4048d55aa` | 526003737 |
| Configurable test program | `9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf` | `55a07af3f185f0dd42c7d80785438ec502e3c74d2382fb7910a7d66827c646e7` | 526007200 |

Both retain upgrade authority `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`. The exact compiled artifacts came from [CI run 45339137899](https://github.com/roger-morrision/funded.app/actions/runs/45339137899). Its contract tree `4184c08bb6561707b0aca99f2bc8c952834b6adf` matches the checkout at verification. No Mainnet transaction was sent.

Confirmed upgrades: [legacy-upgrade](https://explorer.solana.com/tx/2EPLNXh6KvZqrnahJVybHXHe7NYMG1L9uZW4zQgabXhVqdJstHu2rCmsjpRo6osCQDXRNqD2LJehuRMuRGhXmvh5?cluster=devnet); [configurable-upgrade](https://explorer.solana.com/tx/59FMGEWxk8FQ3UNG2aQAX1aKNyeMomf84yoHMyDN6CUcmDVoCeiKNRcM7RncGzdsHJXjtLs9XJN18o94Y1VETLR5?cluster=devnet). The configurable program was extended by 10,240 bytes before replacement. Both upload buffers closed and the temporary 3 Devnet SOL funding was returned with exact balance-delta verification.

## Primary-token rehearsal

On the configurable program, revision 2 used `8FmsUFC9aPepfDtQ6ffM2eTbDBzCWTypRLvZbx65Nvex`. [token-switch-revision-3](https://explorer.solana.com/tx/4Zhpm1NQaaHJcTEqwkUYAGtkxvpGwg5EHRPGZqNkuGba8XUvtjdUWLVzKUgiAofpDaqeC18z9B3P4U5RAeRGGUUK?cluster=devnet) changed it to `C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64` with its matching pool. [token-restore-revision-4](https://explorer.solana.com/tx/293XquEjLaJKXfjbdqSBvV6jfLN1G9sApkuzoMrZ2VTrX9asJDzYWNGQ3uKuXoEgAeFUDdddUkHgSa7321z9cefS?cluster=devnet) restored the original mint and pool as revision 4. Finalized reads matched both new revision records, retained revisions 1–2 unchanged, and proved that token administration did not alter deployed bytecode.

Signed Devnet simulations rejected an unauthorized administrator, a skipped revision and a mismatched mint/pool. These rejection checks were simulations; the two successful configuration changes were real finalized transactions.

The live app continues to use its compatible program at `9H1…`, with primary mint `C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64`. It has the latest code for that variant. This rehearsal does not migrate the live app to the separate configurable ABI.

## Validation and limits

- 75/75 security tests passed inside the final Node v24.22.2 image. Source-size checks passed for 1,546 maintained files.
- CI passed compiled-SBF configurable administration/stale-order, custody and financial CPI tests. Those are local-bank tests, not new live financial executions.
- The configurable upgrade preserved 34 program-owned accounts in its immediate before/after snapshots.
- Legacy owner scans were inconsistent. Direct reads found all 2,109 captured baseline accounts; the three content changes inspected had successful transactions before the upgrade. Full owner-inventory preservation is not claimed.
- Public app, launch/escrow readiness and all six services verified against the new hash. This is deployment acceptance, not proof of a new trade or payout.
- The local Devnet launcher now reads the current V3 pin from `.env.deploy` instead of an older test-release file.

Exact public evidence and transaction signatures are in [the JSON report](evidence/devnet-program-upgrade-2026-11-25.json). Current ELF/ProgramData baselines are retained under `.secrets/funded-vip-deployment/contract-artifacts/20261125`. Historical offline unsigned fixtures keep their original captured commitments.

Future code upgrades remain available through the retained authority; see [program upgrade checks](program-upgrades.md). An app-only rollback after a contract upgrade will retain a stale program hash. Coordinate any rollback binary, finalized hash, app, workers and signer configuration together.
