# Contract account setup moved to app services

This change moves associated token account (ATA) creation out of the developer-token escrow and both community-drop opening handlers. The app submits idempotent ATA creation immediately before the custody instruction in the same transaction. Failure rolls back both instructions. This is a local build and VM verification; no program has been deployed by this change.

The escrow still checks the canonical vault, mint, token program, creator, unsafe mint extensions, delegates, close authority, exact transfer deltas, 20% supply cap, 12-hour deadline, and single release. Community drops retain snapshot authorization, canonical accounts, reserve accounting, Merkle proofs, claim replay protection, expiry, and remainder destinations. Pre-created community vaults must be empty and have neither a delegate nor a close authority. Program-owned state creation remains on-chain because it requires PDA signing.

Instruction discriminators, account order, serialized state, and events are unchanged. A caller constructing a bare custody instruction must now create its required ATA first. The app's launch/release helpers, automatic delivery service and standalone community worker submit the complete sequence. The standalone worker validates the canonical ATA setup before signing. `/api/airdrops/claims/opening-instruction` now includes an ordered `instructions` array; clients must submit that entire array atomically. The existing top-level instruction fields remain for legacy consumers.

## Coordinated rollout

1. Ship the app builders and verify the candidate programs on Devnet. Escrow ATA setup is compatible with the existing escrow's idempotent setup.
2. Keep `FUNDED_V3_COMMUNITY_ACCOUNT_SETUP=program` for the existing router. Its old community opening instructions require a new ATA and reject pre-created ones.
3. After a reviewed router deployment is confirmed and its bytes verified, update `FUNDED_V3_PROGRAM_DATA_SHA256` and set `FUNDED_V3_COMMUNITY_ACCOUNT_SETUP=app` together. Redeploy the standalone community worker if it is in use, with the new image and hash pin. Resume workers only after that verification. All callers of the opening endpoint must use its ordered instruction array.
4. Select and review the actual production build separately. The current default router and `devnet-v3-program` build expose different instructions; this optimization does not turn the Devnet agency build into a Mainnet release.

## Reproduce verification

Build each baseline and candidate in a separate `CARGO_TARGET_DIR`. Reusing one target across copied workspaces can reuse stale artifacts. Use the same driver, platform tools, architecture, Cargo.lock, and release profile on both sides. Local measurements use the cached driver reporting `cargo-build-sbf 4.1.0`, SBF v0, platform-tools v1.54 for routers and v1.53 for escrow. No compiler optimization settings were changed.

```sh
# From contracts/funded-fee-router; repeat for each isolated source snapshot.
CARGO_TARGET_DIR=/tmp/router-candidate cargo-build-sbf --manifest-path programs/funded-fee-router/Cargo.toml --arch v0 --tools-version v1.54 --sbf-out-dir target/size/default -- --locked
CARGO_TARGET_DIR=/tmp/escrow-candidate cargo-build-sbf --manifest-path programs/developer-token-lock/Cargo.toml --arch v0 --tools-version v1.53 --sbf-out-dir target/size/escrow -- --locked
CARGO_TARGET_DIR=/tmp/agency-candidate cargo-build-sbf --manifest-path programs/funded-fee-router/Cargo.toml --features devnet-v3-program --arch v0 --tools-version v1.54 --sbf-out-dir target/size/agency -- --locked

DEVELOPER_LOCK_TEST_SO="$PWD/target/size/escrow/developer_token_lock.so" cargo test --locked -p developer-token-lock --test app_account_setup
FUNDED_ROUTER_TEST_SO="$PWD/target/size/default/funded_fee_router.so" cargo test --locked -p funded-fee-router --test app_account_setup
FUNDED_ROUTER_TEST_SO="$PWD/target/size/agency/funded_fee_router.so" cargo test --locked -p funded-fee-router --features devnet-v3-program --test app_account_setup
```

From the app root, run `node --test tests/app-account-setup.test.mjs tests/program-deploy-cost.test.mjs`, `npm run check`, and `npm run build`. CI now runs these app regression tests and the compiled-bytecode custody tests and uploads executable byte counts alongside hashes.

Tests exercise missing/pre-existing ATAs, atomic setup rollback, malformed custody, invalid amounts and mint extensions, release at the exact deadline, recreation of a closed recipient ATA, direct and reserve-funded community openings, unauthorized snapshots, invalid claims, replay, expiry, and fixed remainder destinations. App tests cover legacy/new router setup modes, both token programs, instruction ordering and serialization size.

Local verification completed: **9 compiled-bytecode VM tests passed** (4 escrow, 2 default router, 3 agency router), **11 JavaScript tests passed** including standalone-worker setup validation, JavaScript syntax checks and source-size budgets passed, and the Vite production build passed. The build retains existing Anchor cfg/glob warnings and Vite chunk-size warnings. Hosted CI and on-chain deployment verification have not run for these candidates.

## Deployment-cost interpretation

| Build | Before bytes | After bytes | Saved bytes | Estimated locked rent saved |
|---|---:|---:|---:|---:|
| Default fee router | 835,496 | 830,584 | 4,912 | 0.024953 SOL |
| Devnet agency router | 1,046,360 | 1,043,256 | 3,104 | 0.015768 SOL |
| Developer-token escrow | 217,864 | 208,280 | 9,584 | 0.048687 SOL |

The default router plus escrow saves **14,496 bytes / approximately 0.073640 SOL** under the assumptions below. The agency router plus escrow saves **12,688 bytes / approximately 0.064455 SOL**. The two router rows are alternative builds, not two contracts to deploy together. The reduction is deliberately limited to account setup; allocation, approval and custody rules remain enforceable by the programs.

Candidate executable SHA-256 values:

```text
default  9a21e4aeba41c3fcf660a7fd9805302126e5dace8c360379f1927009f38543fc
agency   5853367c900457e5314d423d1fb5fa70ab98606e1270ebda70dd21551d016905
escrow   bd7b79e418c53ca0fcbf2d3c8180ccc9eb5f01f8fd23d29a06b9e57eb0a4369c
```

These are executable hashes, not full ProgramData hashes to paste into deployment configuration. Local artifacts, build/test logs and the machine-readable comparison are under `tmp/contract-size-20261107/`; they are ignored build output.

Only compiled executable bytes determine this size comparison. The existing offline estimator assumes 5,080 lamports per byte; this is an input assumption, not a live Mainnet quote. For a fresh deployment with `max_len` equal to the binary size, saved locked rent is `saved_bytes * 5080 / 1e9` SOL. Larger maximum allocations can erase the saving. This does not reduce ATA rent, and shrinking an executable does not automatically shrink an existing ProgramData allocation. Buffer funding is temporary and deployment transaction fees are separate. See [Solana program deployment](https://solana.com/docs/core/programs/program-deployment).
