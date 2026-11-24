# Mainnet launch readiness integration — 2026-11-24

The launch capability endpoint previously depended on a Devnet signer getter and could not inspect production prerequisites independently of signing. `createV3LaunchConfig` now selects a dedicated public Mainnet reader. The Devnet execution path is retained.

`GET /api/v3-launch-config` returns a separate `preparation` result. It can verify public program prerequisites after a valid independent release manifest and production configuration exist. Its top-level `ready` remains false and `preparation.signingEnabled` remains false even when those prerequisites verify. Registration and launch-reserve endpoints remain blocked. The current committed release is incomplete, so the real generated configuration returns `blocked` without constructing an RPC connection or requesting a signer.

## Public verification

- Exact reviewed loader ownership, canonical ProgramData pointer, upgrade authority, full ProgramData hash, ELF hash, padding and effective deployment slot.
- A single finalized snapshot for the program, ProgramData, guarded router, independent price signer, primary asset configuration, agency configuration and both lookup tables. The returned context must be at least the finalized tip requested before the read.
- Selected operator and guardian, unpaused Mainnet guard, distinct public custody roles and exact price-attestor account.
- Reviewed primary mint and pool, plus the matching immutable asset revision read at or after the snapshot.
- On-chain agency rules, allocation and revision matching the published application policy.
- Lookup-table owner, active status, nonempty addresses and completed warmup. This does not prove that a table contains every account needed by a future launch transaction.

Concurrent callers share one in-flight read. Subsequent calls re-read the deployment; no successful proof is cached. Database and RPC waits share a bounded timeout. A blocked release retains the published fee display policy without treating publication as on-chain verification.

The configuration generator now includes the selected operator, guardian and price-attestor public addresses. The staging template exposes those public fields and the missing lookup-table references. New local reference-only output: `.secrets/mainnet-runtime-20261124.env`. It remains incomplete and is not a deployable environment.

## Executed checks

- 47/47 required security regressions passed, including seven new runtime/route cases and the existing settings integration cases.
- Six release-validation regressions passed separately.
- Syntax checks passed for 1,243 JavaScript files; size checks passed for 1,511 maintained files. The two subsequently adjusted files also passed focused syntax checks.
- A local probe using the actual generated configuration returned `ready: false`, preparation `blocked`, zero signer calls and zero RPC connections.
- CCE indexing completed successfully on this attempt.

All positive Mainnet account/review examples are fabricated test fixtures. No production key, real Mainnet transaction, Pinata upload, live program deployment or financial acceptance was exercised.

## Remaining production work

This change integrates public readiness, not transaction execution. Mainnet launch submission and registration, collection and payout workers, custody-backed runtime admission, metadata publication verification, recovery acceptance, independent release approval and the separately approved canary remain outstanding. The read-only proof does not authorize or enable any of those actions and does not establish pool liquidity or signer-service health.
