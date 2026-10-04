# Contract readiness — 2026-10-04

Canonical source: `contracts/funded-fee-router`. This is an implementation review and local verification by the development team, **not an independent security audit or approval to launch Mainnet**. No program deployment or upgrade was performed for this review.

## Compatible hardening

The instruction discriminators, account lists, account layouts, PDA seeds, and leaf domains remain unchanged.

- Reward token payouts now reload source and recipient token accounts and require the exact committed amount to leave the vault and reach the recipient before a payment record/event is emitted. Token-2022 transfer fees and self-transfers previously allowed a successful CPI to be recorded as a full payment; they now fail atomically. Fee-bearing assets need a separately designed net-amount policy before support.
- SOL rewards reject the vault itself as recipient. Credits use checked arithmetic.
- Reward creation rejects a zero Merkle root; payout proofs are limited to 32 sibling hashes (the tree index is `u32`). Distribution totals are assigned only after limit validation.
- Legacy settlement rejects empty payout lists, read-only destinations, and router self-transfers. Existing legacy transfers to the signing authority remain supported; the pre-existing per-mint exclusion is unchanged. Both settlement paths validate router ownership and use checked destination credits. The legacy path validates its stored PDA bump.
- Mint-router initialization checks the legacy router owner and bump. Header repair validates program ownership and restores the canonical bump.

These source fixes do not change the bytecode already deployed on Devnet. A reviewed, reproducible program build and authorized upgrade are required to activate them on a cluster.

## Existing guarantees and remaining boundaries

| Area | Enforced by the current program | Remaining dependency or limitation |
| --- | --- | --- |
| Settlement | Authority signature, router PDA/header, available balance after rent, one-time claim PDA; per-mint claim records mint/recipient/amount | The authority selects the payout recipient and amount. The policy hash alone does not enforce fee percentages, X entitlement, creator ownership, or the buyback route. |
| Reward claims | Committed root, recipient/asset/amount/index leaf binding, payout time, cycle total, one payment per recipient per cycle | The authority chooses the root and total; creation does not reserve funds per cycle. Roots with repeated recipients make later leaves for that recipient unclaimable. The manifest builder must aggregate recipients and reconcile funding. |
| Community claims | Drop-bound Merkle leaf, token mint/owner constraints, exact delivery, one payment per recipient, 90-day window, immutable expiry remainder recipient | Migration signature/hash/slot values are commitments supplied by the operator, not independently verified migration or holder-snapshot evidence. Direct creator-funded initialization permits any signing protocol authority namespace. Only router-authority-bound drops should appear as official. |
| Rotation | Old, new, and upgrade-authority signatures; canonical router and supplied mint-router checks | Rotation is opt-in per supplied mint router. Existing RewardVault PDA seeds contain the old authority. Old-vault creation of new cycles and community opening stop after global rotation. Already committed reward payouts remain permissionless. There is no recovery if the old authority key is lost. |
| Upgrade | The upgradeable loader controls bytecode replacement | Current upgrade authority, multisig controls, and deployed binary hash require live independent verification. Source-level checks are replaceable by the upgrade authority. |
| Initialization | Canonical singleton PDA; initialization allowed once | The first caller selects global authority. Deploy and initialize atomically where supported, or add verified deployment-authority initialization in a versioned release. Sending lamports to an uninitialized router PDA can prevent the current create-account path; prefunded-PDA recovery needs a separate reviewed change. |
| Emergency handling | Funds cannot be paid twice using an existing claim/payment PDA | No explicit global pause mechanism exists. Service-worker pause does not stop permissionless payout of already committed proofs. Do not present service pause as an on-chain freeze. |

## Concrete next-version migration design

1. Introduce a deployment-authority-verified configuration initializer, with explicit program/ProgramData verification and two-phase governance rotation. Preserve current PDAs during migration and make pending versus active authorities observable.
2. Introduce immutable per-mint policy accounts binding creator, entitlement identity, approved collection/reward destination, basis-point shares, and policy version. Validate settlement against these accounts; do not reinterpret the existing policy hash as recipient enforcement.
3. Separate vault identity from mutable authority in a versioned PDA. Migrate old vaults atomically with proofs of source owner, destination policy, exact token/SOL balance deltas, and committed unpaid obligations. Preserve old proof domains and payment records for outstanding cycles.
4. Reserve funds per committed cycle and reject aggregate obligations above escrow. Publish a deterministic manifest schema requiring unique recipients and reproducible root generation, and bind the next leaf version to program, vault, cycle, and asset. A new domain must not invalidate existing claim proofs.
5. Specify multisig emergency/recovery powers, timelocks, and public events before implementing them. Test compromised-key and lost-key procedures on Devnet with separate roles.
6. Obtain an independent review, deploy the reviewed artifact to Devnet, rerun full claim/settlement/rotation/recovery flows, then record program data address, authority, binary digest, and finalized transaction evidence before considering Mainnet.

## Verification

Verified locally on 2026-10-04:

- Rust `1.89.0`; `cargo test --locked --lib`: **4 unit tests passed**.
- Agave distribution `4.1.2` (`cargo-build-sbf` reports `4.1.0`), platform-tools `v1.54`, SBF architecture `v0`: **optimized deployable program build passed** with the committed lockfile unchanged.
- `cargo test --locked`: **11 tests passed**, including 7 LiteSVM tests executing the newly built SBF bytecode. Coverage includes initialize and per-mint settlement; empty/read-only/self/zero/insufficient settlement rejection; community valid claim, duplicate/ineligible rejection, expiry and correct-owner closeout; wrong-key wrapped SOL recovery rejection and valid recovery; SOL reward early-payment/wrong-proof/replay/self-payment rejection; and Token-2022 zero-fee success versus transfer-fee rollback of balances, cycle obligations and payment creation.
- Program artifact: `contracts/funded-fee-router/target/deploy/funded_fee_router.so`; SHA-256 `0f7eaa00e61da306e38b8833af3dac829fe38321eae8555247e7bd6efa4241e4`. This is the local changed-source artifact, not the deployed Devnet binary.
- `git diff --check` passed for the contract changes.

Reproduce from `contracts/funded-fee-router` after installing the pinned Rust toolchain and Agave `4.1.2`:

```sh
cargo-build-sbf --manifest-path programs/funded-fee-router/Cargo.toml --arch v0 --tools-version v1.54 -- --locked
cargo test --locked
```

Agave Linux x86-64 download: `https://github.com/anza-xyz/agave/releases/download/v4.1.2/solana-release-x86_64-unknown-linux-gnu.tar.bz2`; observed SHA-256 `5991d027a686eb419a709a479178b33eb83501e8a2bfbf599a81a286bfcbf770`. Check the archive digest before extracting. The `--arch v0` build is compatible with the pinned LiteSVM runtime; host-only unit tests do not replace these bytecode tests. Build output and generated keypairs remain ignored.

Local LiteSVM or validator signatures are not Devnet or Mainnet transaction evidence. Independent Devnet and local-validator evidence is recorded separately in the session's verification report.
