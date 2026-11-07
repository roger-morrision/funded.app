# Merged router and developer-token escrow

New launches can use the router itself for the 12-hour developer-token escrow. The merged instructions retain the standalone escrow's instruction names, account layout, seed text, transfer checks, fixed beneficiary, exact deadline, 20% supply limit, mint-authority checks and permitted Token-2022 extensions. Token-account setup remains an earlier instruction in the same atomic app transaction.

The standalone escrow source and deployment remain available for existing locks. Its PDAs cannot be signed by the router. The app therefore uses the program ID recorded on each launch for custody reads, release instructions and receipt verification; older records without a program ID use the standalone escrow. Pending release storage is separated by program while preserving old receipt keys. A launch signed before cutover can still be registered against the separately pinned legacy program.

## Measured compiled sizes

Pinned SBF v0 builds use platform-tools v1.54 for the router and v1.53 for the unchanged standalone escrow. Baseline is commit `9be40c0a22dfb23bc913beeaf5c4f03c11051bbd`. Each merged variant uses an isolated Cargo target directory.

| Variant | Separate router + escrow | Merged program | Removed bytes |
|---|---:|---:|---:|
| Default router | 1,038,864 | 881,160 | 157,704 |
| Devnet agency router | 1,251,536 | 1,093,784 | 157,752 |

At the Mainnet rate measured on 2026-11-07 (5,080 lamports per allocated byte, including account overhead), fresh exact-size deployments save approximately **0.803 SOL** for either variant, including one fewer Program account and ProgramData header. Per-launch state and token-account rent are unchanged. This is not a Mainnet authorization or a guarantee that the final production artifact has the same size. The agency build remains Devnet-only.

The merged agency binary is larger than the existing router's allocation, so the Devnet router must be extended before upgrading. Existing standalone escrow rent remains locked while that program serves old balances; Devnet does not immediately recover the fresh-deployment saving.

Executable hashes:

```text
default c77982074654bcbeba2da9c6f33ebbe6d7ee975f2d98732d8f0411663cade4d8
agency  4736fa6ceeef6ac6a2dd7d550b4b7d5e68a728f290ba53f4528a69087775f0f2
```

## Cutover configuration

Prepare the matching app image before the router upgrade. Keep the accepted release lock through the on-chain change and app switch. After finalized byte-for-byte verification, set:

- `FUNDED_V3_PROGRAM_DATA_SHA256`: full new router ProgramData hash, including its deployment slot.
- `FUNDED_DEVELOPER_LOCK_PROGRAM_ID`: the router program ID.
- `FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256`: the same new router hash.
- `FUNDED_DEVELOPER_LOCK_LEGACY_PROGRAM_DATA_SHA256`: the separately verified, unchanged standalone escrow ProgramData hash.
- `FUNDED_V3_COMMUNITY_ACCOUNT_SETUP=app`.

The embedded agency executable commitment in `server/agency-release.mjs` must also match. CI checks it against the compiled artifact. A merged escrow configuration fails closed if its program ID or full hash differs from the approved router. Never close the standalone escrow while it has balances to release.

## Verification

15 compiled-bytecode VM tests passed across the two merged variants: community custody and claims, developer-lock timing and limits, unsafe mint/vault rejection, missing or pre-created token accounts, destination recreation, replay rejection, permissionless fixed-beneficiary release, and simultaneous old/new locks with successful legacy release. The legacy compatibility tests load the unchanged standalone binary alongside each merged router.

19 JavaScript tests passed, including merged launch setup, independent legacy hash pins, receipt identity and token deltas, program-specific pending recovery, launch fee markers, and protection endpoints reading the recorded old/new program. These are local tests; on-chain deployment requires separate finalized evidence.

Run `node --test tests/app-account-setup.test.mjs tests/program-deploy-cost.test.mjs tests/merged-escrow.test.mjs`. For each router variant, run `cargo test --locked -p funded-fee-router --test app_account_setup --test developer_escrow` with `FUNDED_ROUTER_TEST_SO` set to its compiled binary and `LEGACY_DEVELOPER_LOCK_TEST_SO` set to the standalone binary; add `--features devnet-v3-program` for the agency variant.
