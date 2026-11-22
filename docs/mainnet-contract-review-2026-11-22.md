# Mainnet contract security review — 22 November 2026

**Decision: NO-GO for production deployment.** This is an implementation security review by Codex, including review of its own patches. It is not an independent third-party audit, certification, or a claim that every vulnerability has been found. The user's supplied mint is approved for testing only.

## Scope and release identity

Base source for this update: `bc818de225afc7b03f5a1bf08185d68ecc1ac04f`, plus the changes in the commit containing this report. The intended release is the merged `mainnet-v3-program` router, including developer escrow. A separate legacy router/escrow deployment is not required by the current deployment plan.

| Candidate | Bytes | SHA-256 |
| --- | ---: | --- |
| Mainnet-feature public fixture | 1,067,664 | `501dc05e04419ca65f76fa7c59f7a76549baaacb56bf95c371c57f0c19b7cdd6` |
| Devnet-feature candidate | 1,168,752 | `2471016f40f9fdd59127b1c89c84ca0719b4b1880c1637c1b7d3c0b3fdf20c2f` |

Neither candidate is approved for deployment. `config/contract-build-candidates.json` records build evidence separately from runtime trust. The deployed Devnet commitment remains unchanged. The production manifest remains incomplete and disabled.

The candidate manifest's retained-runtime field was stale at the base revision. It now matches the existing `server/agency-release.mjs` commitment (`c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15`, 1,168,496 bytes). The runtime module itself was not changed, and neither new candidate was added to runtime trust.

Build tools: Agave 4.1.2 distribution, whose compiler reports `cargo-build-sbf 4.1.0`; platform tools v1.54; SBF v0; locked Cargo dependencies; size optimization `z`; stripped output. Host tests use Rust 1.97.1 and Node 24.22.3. The Mainnet-feature binary was recompiled from a second source directory and matched byte for byte; dependency caches were reused. This is local reproducibility evidence, not an independent verified build service.

## Findings and changes

| Finding | Severity | Resolution and evidence |
| --- | --- | --- |
| Mature SOL/token reward payouts did not consult the global pause. | High | Payouts now require the canonical router guard as a trailing account and reject a paused guard. Compiled-bytecode tests verify rejected transfers leave custody, reserves, recipients and receipts unchanged. |
| A shared daily cap could delay funded user entitlements. | Policy correction requested by user | Reward commitments and user payouts are exempt. Tests pay queued cycles on the same day above the administrative cap while retaining pause, reserve solvency and replay protection. Operations, promotions and buybacks remain capped. |
| Primary RICH addresses were compiled into the binary. | Enhancement | Owner-controlled, validated, versioned on-chain configuration replaces embedded assets. Immutable history supports old receipts; stale signed revisions and old buyback entrypoints are rejected. See [configuration runbook](primary-rich-configuration.md). |
| Both protected/agency buybacks and agency promotion billing omitted global SOL accounting. | High | Both buyback venues now account for the actual spent lamports within the same atomic transaction; promotion billing accounts before transfer. The promotion test exercises pause, writable guard, replay, daily limit and rollback. Buyback changes are compiled and reviewed; complete external AMM execution remains unverified. |
| Signer health stayed healthy after a journal failure had disabled signing. | Medium | Health returns 503 after the journal failure latch. Tests verify no signature is returned, later requests stay disabled, and health reflects the fault. |
| The build-identity check leaked `mainnet_conversion.rs`, causing its cleanup trap to fail after successful validation. | Medium | Cleanup includes the generated conversion file. Ten invalid program identity/feature/conversion configurations are rejected and the valid fixture exits successfully. Shell files are pinned to LF for Windows/WSL checkouts. |
| Security regression tests were not a required application CI step. | Medium | Added `npm run test:security` to application and contract workflows. Tests cover signer budget concurrency, admin restrictions, durable-journal restoration, corrupt journals, release identity binding, deployed-byte verification and account flags. |

Client compatibility: Mainnet reward builders append a read-only guard account for both SOL and tokens. Mainnet buyback builders and independent price-review canonicalization agree on writable guard flags. The promotion builder accepts an explicit Mainnet cluster and marks its guard writable. Devnet instruction account layouts remain unchanged.

## Executed verification

All following results are **local-only**, using compiled SBF in LiteSVM or host tests. Fixture accounts and balances are **mocked**; no live transaction is implied.

- Mainnet-feature SBF: 22 passing cases — community custody/claims (3), developer escrow (7), protocol guard/reward/promotion controls (7), RICH configuration and stale-order controls (4), and excluded entrypoints (1 test checking 20 entrypoint names).
- Devnet-feature SBF: 15 passing cases — community claims (3), developer escrow (7), token bitmap payout (1), unpaid-cycle expiry (1), receipt/bitmap rent and replay checks (3).
- Host contract test: 1 passing curve-account validation case. It stops before CPI and is not evidence of a completed swap.
- JavaScript security: 15 passing cases, including current/historical configuration decoding, owner instruction encoding, signed revision bytes, app fail-closed behavior and pricing-cache invalidation.
- Ten invalid build configurations rejected; the valid explicit program fixture builds without embedded asset addresses.
- JavaScript syntax, source-size budgets and Vite production build pass.
- Historical verification from the earlier pause/cap patch: its two SOL payout regressions were run against the original pre-fix bytecode (`d2006da19720c2c9c6383cad05e9d684ea19591eacc737a06012e03ef1c676dc`) and both failed as expected. That earlier result does not certify the subsequently revised cap policy; the current uncapped-user policy is covered by the 37 tests above.

Reproduce using the pinned build/test commands in `.github/workflows/contracts.yml` and `npm run test:security`. Public fixture identities in that workflow are intentionally rejected by production runtime release validation.

Clean Linux CI passed for the contract-fix commit `333d94104012a708b25080bd528d27dee9a50e13`: [contract builds, exact hashes and custody tests](https://github.com/roger-morrision/funded.app/actions/runs/44976196983), and [application/security checks plus Docker build](https://github.com/roger-morrision/funded.app/actions/runs/44976197035). The subsequent test-dependency patch is separately revalidated locally below; these CI links do not claim to test a later commit.

## Dependency advisories

`cargo-audit 0.23.0` checked all 423 lockfile packages against RustSec database commit `55e1c3dfbd834237a05bbbf7b50ba3b5be27b662`. It initially reported two vulnerabilities. `ctutils` was updated from 0.4.2 to 0.4.4, resolving [RUSTSEC-2026-0385](https://rustsec.org/advisories/RUSTSEC-2026-0385.html).

[RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387.html) remains for `crypto-bigint 0.5.5`. The path is LiteSVM → Solana syscalls → secp256k1 recovery → k256/elliptic-curve → crypto-bigint. Both affected packages are outside the normal/build dependency graph for both workspace programs across all targets; they enter through test dependencies. The patched crypto-bigint series is 0.7.6+, incompatible with the existing upstream 0.5 dependency constraint. An upstream SDK/test-runtime migration is still required; no advisory is suppressed or represented as fixed.

The full lockfile audit therefore still exits 1. It also reports maintenance warnings for `ansi_term`, `bincode`, `derivative`, `libsecp256k1` and `paste`; maintenance warnings are distinct from the two timing vulnerabilities. The recorded dependency graph scope does not constitute a general side-channel audit. Tests use ephemeral fixture keys only. Machine-readable results are in `docs/evidence/contract-dependency-review-2026-11-22.json`.

After the `ctutils` patch, the earlier 33 targeted bytecode tests passed with unchanged earlier ELF hashes. The later payout/configuration changes in this update add four tests: all 37 pass locally, with the new hashes listed above. The dependency patch itself changes only the host test runtime.

## Supplied test mint

Read-only finalized Mainnet RPC evidence is stored in `docs/evidence/mainnet-test-mint-2026-11-22.json`.

`Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr` is a classic SPL mint with six decimals and neither mint nor freeze authority. A separate Devnet read returned no account. Its metadata was used in the isolated token-reward custody test; synthetic token balances were injected into LiteSVM.

The canonical SOL PumpSwap pool `B78z5Xp4f8sEDgXnjBB4hxFQiPZDCageod5j3NtBpB5B` and Pump bonding curve `EnUAdYkZQpssfamcu75RAe6smtE9bcWR4gvHmZhB3S25` did not exist at the recorded Mainnet slot. This does not rule out other venues, but this mint cannot yet supply evidence for the contract's supported buyback venues. It was not installed as a production RICH asset.

## Remaining deployment blockers

1. **Production identities are unavailable.** Select the dedicated program address, production RICH mint and supported pool, guardian, fresh operational/price signers and approved upgrade authority. Compile the dedicated production program identity, reproduce and review the bytes, then initialize the owner-controlled RICH configuration with the supported production mint/market. Subsequent RICH changes do not require recompilation. No private keys should enter this report or repository.
2. **The configured budget is insufficient for the current fixture.** A fresh Mainnet RPC quote gives 5.425445080 SOL locked rent with exact-size allocation, before fees, initialization, liquidity or the plan's 3 SOL operating reserve. The total plan currently caps spending at 5 SOL. Evidence is in `docs/evidence/mainnet-contract-rent-2026-11-22.json`. Final production bytes need a fresh quote; the user's budget was not increased.
3. **End-to-end financial acceptance remains incomplete.** Buyback CPI/burn, paired-token conversion with the independent signer, fee collection/disbursement across every category, token extensions, compute ceilings, authority rotation/recovery and a capped deployment canary need current finalized transaction and state/balance-delta evidence. Compiling these paths is not proof they execute successfully.
4. **Mainnet application signing/worker integration remains blocked.** The operational signer and price-signer bootstrap still reject non-Devnet operation. Launch/registration, metadata, workers and journals retain network gates. Their restrictions were preserved; switching a cluster string would not constitute a safe implementation.
5. **Full independent review is outstanding.** The production release configuration requires a review tied to exact source/binary hashes. This self-review does not satisfy that gate. Do not fill those fields with this report to bypass it.

## Guard policy and residual trust

The administrative cap is denominated in **SOL** and applies to operations withdrawals, promotions and buybacks. Verified creator/X/referral disbursements, reward-vault transfers, reward commitments and SOL/token user payouts do not consume this cap. Mainnet reward cycles retain the 24-hour guardian review delay; payouts retain pause, liability, recipient/proof and replay checks. The canonical payout guard is read-only to avoid global write contention.

Token payouts obey pause and immutable per-cycle liabilities, but the global SOL cap does not cap raw token units. Token valuation/per-asset risk limits require a separate policy decision and review. Community snapshots require owner authorization; developer escrow release and user entitlement claims retain their separate custody rules. A global worker pause is not a promise to freeze every user-owned asset.

The retained upgrade authority can replace the code. Operational controls, guardian monitoring, independent price signing and recovery rehearsals remain part of the security model. No Mainnet signing, deployment, funding or runtime activation occurred during this review.
