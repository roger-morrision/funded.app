# Historical Devnet settlement recovery candidate

Status: **the original two claims are finalized; a later collection makes current public verification 30/31**.
The user explicitly approved the restricted upgrade, both settlements and
proof-gated shared-ledger reconciliation, choosing to fund the QA payer and
preserve its 3 SOL reserve. Funding finalized before execution. The running app
revision is `467984011d0f0058c595e2e44d9c9820c11763d3`.

At 2026-10-19T04:39:21.866Z, public `/api/status` reported
`settlementVerified:true`, `recorded:30`, `checked:30`, `recoveredRecords:1`.
No collection was deleted, excluded or relabeled as a recipient payment.
At 04:40:41.953Z, the collector made a new 1,484,671-lamport collection for
the same lost-creator QA mint. The existing pending-settlement gate correctly
allowed it after the older claims finalized. Its new claim is outside the
approved one-claim exception and remains pending, as described below.

## Independently checked source collections

| Mint | Pump collection transaction | Claim ID | Lamports | Finding and repair |
| --- | --- | --- | ---: | --- |
| `33NWqBP7VedxoKm5M7qZbb8LT6xvBu8iHQrwD5wkbkKH` | `1czZxRueqMh6XWPoLS37tA4JgaxFGeaNU5JPszEMRuygzy67AwaN4QTWmAhKASyojG3D45RwYZPtHNqNJKt9orA` | `5ca381169749d2c31183eaaaa51639ccafb63c2ebb93f21d6721a001e07aeb8b` | 204,105 | Source proof passes; claim absent; old pending transaction absent and its blockhash expired. Six separate trade transfers left an additional 600,000 lamports in its router. Settle the creator-and-authority-approved amount, preserving surplus and rent. |
| `HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL` | `24WvRWrP7gc5WXGEeEpM9RaNAhQD6r9bSzGG3jVZTCSQgzvYqhzp9TsAzmSYQG58BbiQFU4NMDypmUthePFMDHuZ` | `ff1ae71ac5e2d2eedb9817b82943c54528e81886a573e49ce1300c1d16c02d0f` | 742,575 | Source proof passes; claim absent; exact amount remains in router. User reported creator `89cmvLYLdvm9XRa1gu4DB8zzhmUsEjPWuTM1ahJzpkZM` unavailable. Prepare the expressly approved one-claim exception. |

## Contract restrictions

Normal settlement still requires the current router authority and original
creator to sign. It accepts only a positive approved amount covered by the
router's spendable balance. Excess funds stay in the router. Category accounting
uses the existing cumulative rounding and immutable policy.

`recover_qa_settlement_v3` is compiled only with `devnet-v3-program` and enforces:

- Program `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`.
- The exact second mint, creator, claim ID and 742,575-lamport amount above.
- Signing authority `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`, also checked against the global router.
- Original protocol units `[1000000,200000,60000,40000,200000,500000]`.
- Prior cumulative settlement of 322,917 lamports and exact prior allocated category totals.
- The seven existing, ordered category PDAs, unchanged beneficiaries and rent protection.
- A newly initialized claim PDA: replay fails atomically.

It does not change the creator or fee percentages, create a generic recovery
endpoint, authorize withdrawals, or migrate old balances to another mint.
Historical downstream withdrawals that still need the unavailable creator are
not repaired by this settlement instruction. Do not describe vault funding as
holder, X, referral, community or creator payment.

Expected category deltas (creator, operations, referral L1/L2/L3, community, buyback):

| Mint prefix | Exact lamport deltas |
| --- | --- |
| `33NW…` | `[163284,16328,4082,1225,816,8164,10206]` |
| `HdGm…` | `[594060,74257,14852,4455,2971,14851,37129]` |

The older mint retains its original gross 10% operations / 2% community policy.
It must not be silently repriced to the newer 8% / 4% policy.

## Validation and artifact

- Final JavaScript suite: 903 total, 894 passed, 9 skipped, zero failures.
- Focused settlement/provenance checks after the final status change: 14 passed.
- Devnet candidate SBF: all 14 applicable Rust tests passed, including three new
  historical regressions, ten altered-recovery cases, missing creator signature,
  overdraw, zero amount, replay, surplus preservation and prior withdrawal preservation.
- Historical fixed-address VM fixtures disable signature cryptography to avoid
  needing those private keys; program signer constraints still execute. Existing
  V3 tests exercise transactions signed by generated test keys. These are local
  VM tests, not finalized Devnet execution.
- Default-only legacy tests are feature-gated; they remain in the default suite.
- Default contract binary: all 20 tests passed, including dispatch rejection of
  the Devnet-only recovery instruction.
- Production app build passed. No UI behavior was changed by this candidate.
- SBF compiler: `cargo-build-sbf 4.1.0`, pinned platform-tools v1.54, architecture v0,
  locked dependencies. Container host-test Rust: 1.98.1. WSL's Rust 1.97.1 host
  run was interrupted when C: filled; a generated cache was removed and remaining
  tests ran in the isolated container. The default SBF built before WSL stopped.
- Devnet artifact: 745,720 bytes; SHA-256
  `6b79ba2770494c8c5de4532234e3e515e43d6e038a0f88949f6546961d40f952`.
- Padded executable payload (780,000 bytes) SHA-256:
  `f38e2161fb6dd6be6d6b3998834ffa4538902677af9450f1e89ee9a99bba95d3`.

**The padded payload hash is not the runtime configuration pin.**
`readProgramDataEvidence` hashes the complete ProgramData account, including its
45-byte upgrade metadata and new deployment slot. After an approved upgrade,
compare exact executable bytes and zero padding, verify authority and owner,
then calculate and configure the complete account hash.

## Read-only preparation and release gates (execution record below)

Run `scripts/prepare-historical-settlement-recovery-devnet.mjs` with `--records`,
`--artifact`, `--artifact-sha256`, `--current-program-sha256`, and `--report`.
It reads no signing key and performs no submissions or ledger writes. It checks
Devnet genesis, current bytecode pin, upgrade authority, exact finalized source
collections, immutable policies, missing claim PDAs, retry eligibility, rent,
balances and the unsigned instruction accounts.

The checked manifest is under ignored evidence directory
`data/qa-evidence/historical-settlement-recovery-20261019/prepared-manifest.json`.
At 2026-10-19 03:43 UTC:

- QA authority balance: 4.588452592 Devnet SOL.
- Fresh upload-buffer rent from RPC: 3.789095800 Devnet SOL; refundable on successful upgrade/closeout.
- Estimated fee and new-account rent budget: 0.03 SOL; total settlement allocation 0.000946680 SOL.
- Preserving the existing 3 SOL payer reserve requires at least 6.819095800 SOL
  before upload (additional 2.230643208 SOL). Recheck immediately before execution.

Before claiming completion:

1. Verify the user's execution approval and chosen reserve before spending.
2. Recheck source, old pending signature, claim absence, exact artifact and payer budget.
3. Upgrade only this Devnet program; verify exact finalized executable and full ProgramData hash.
4. Release matching server verification code and configure the new complete account hash.
5. Journal each signed transaction before broadcast; reconcile uncertain receipts before retrying.
6. Settle 204,105 with the original available QA creator; settle 742,575 only through the restricted instruction.
7. Independently verify finalized transaction instructions, category claim accounts, policy totals,
   exact router debits and preserved surplus/rent. Record the recovery authorization provenance.
8. Reconcile the two ledger records through the strict proof loader and allocation-plan logic,
   preserving their frozen referral uplines and all prior payouts.
9. Recheck every recorded collection on public `/api/status`; require 30/30 verified with no excluded records.
   The status verifier requires the recorded recovery authorization to match the
   finalized instruction and reports `recoveredRecords:1` separately.

No records have been removed, reclassified as paid, or excluded to obtain a green status.

## Finalized execution and independent verification

| Operation | Finalized transaction | Verified result |
| --- | --- | --- |
| Approved program upgrade | `3vYsJcrh5CN4za1nXQxeyUTu6DASZVFpS4orjb6HqJxjbw7EUbLEuk34mQ4qxUJFXkdMqjiRJ71X4RbKkEA3Ag8N` | Slot 512678515; upgradeable-loader instruction targets the original program and ProgramData; exact candidate executable and zero padding verified. |
| Normal historical settlement, 204,105 lamports | `esW4pBHz7Qu7Ytpm4t4BeFCm4KAb41QBLhpw7abhkDMvfSDJ6o8gaWW5AGHBYCBZB4gjd9Bc3koXxBy1TsvDVU9` | Authority and original available creator signed. Claim, seven category credits, router debit and cumulative policy match; 600,000-lamport surplus remains. |
| Restricted historical settlement, 742,575 lamports | `5GcEJLtswNbz3uo8cRfgfQncpYnDwsRGe7uDicXN1uFwRU617GfQnYdaQ3AyDj4jZ4V4uamvsD5Tcm4LNnG2mrqu` | Exact approved exception; original historical split, claim, beneficiaries, seven category credits and prior withdrawals preserved. |

The new complete ProgramData account hash, including deployment metadata, is
`5e2cc6e58544fc1498810be42c25814c72c4cc2218ea8ce3c2cd274d18732c64`.
This pin is configured in the existing Devnet app and workers. Their image and
source revision remain the tested `4679840` app release.

The upload used the installed Solana CLI through a local RPC journal proxy.
Signed transaction bytes were fsynced before broadcast. The proxy passes RPC
response bytes unchanged to preserve u64 values. Two preflight failures occurred
before any submission and were corrected before upload. The final CLI run made
779 submission requests; net upgrade fees were 3,900,000 lamports, with the upload
buffer rent refunded. The original program ID and upgrade authority are unchanged.

Both settlement transactions were simulated with signatures verified and
journaled before broadcast. The first receipt's raw vault credits also included
seven authority-funded 650,240-lamport rent top-ups. Independent verification
checks those inner system transfers separately from the exact fee allocations.
The verification paused at that distinction, then reconciled the already-finalized
first transaction without resubmitting it before executing the second.

Both entries were reread through the running app's strict finalized collection
and settlement proof loaders, including cumulative positions. The ledger update
was atomic and checked for concurrent changes. The expired earlier attempt was
preserved in the recovery audit, along with original frozen referral uplines.
Both allocation plans remain correctly labeled `allocated-not-funded`; category
settlement alone does not prove any downstream recipient payout.

The payer had 14.588452592 SOL before upload and 14.577222392 SOL after both
settlements. Total net cost was 0.0112302 SOL, below the approved 0.03 SOL budget;
the 3 SOL reserve was preserved. The 14 focused recovery tests passed again.
The unchanged app release had 910 passing unit tests, nine skips, seven passing
mocked browser checks, and a passing production build.

Ignored evidence is retained under
`data/qa-evidence/historical-settlement-recovery-20261019/`, including the fresh
preflight, signed-transaction journals, complete byte proof, finalized upgrade
instruction, settlement proofs, atomic reconciliation report and public status.
These records contain public transaction evidence, not private signing keys.

## New claim discovered during final verification

- Mint: `HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL`.
- Finalized collection: `4VtYV4QBomTFcNZQZ4o36Pfe8FwCSRkvtkFNqTWinwLJ8JYsymGUyNmThvHKoAavqZhyU2SgfiUhay6AVG3hAmqB`.
- Amount: 1,484,671 lamports; source slot 512680377.
- Claim ID: `9cadcccb3d2554a50853fe7b7cbb263fb5cae08150ec1a9cfb0cb51108c4f864`.
- Prior cumulative settlement: 1,065,492 lamports; original 10% operations / 2% community policy remains fixed.
- Source proof independently verified. No new recovery instruction was submitted.
- The user separately approved preparing, deploying and executing this exact-claim recovery, preserving the 3 SOL reserve, original split and beneficiaries. Its build and execution are tracked separately from the completed first recovery.

`FUNDED_FEE_COLLECTION_PAUSED_MINTS` now supports a comma-separated per-mint
operational pause. The Devnet worker skips configured mints, keeps all prior
records visible and reports the pause in its heartbeat. Its single-pass mode
supports verification without entering the scheduler loop. An actual-worker HTTP
test proves the paused mint is skipped while another mint still collects; invalid
pause configuration stops before any collection. Configure this QA mint as paused
before resuming the collector or completing any additional recovery.
