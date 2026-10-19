# Historical Devnet settlement recovery candidate

Status: **prepared locally; neither historical settlement has been submitted**.
The user authorized preparation of a restricted recovery for the unavailable
historical QA creator. Execution of that authorization exception remains a
separate release step. Public status still verifies 28 of 30 collections.

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

## Read-only preparation and release gates

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

1. Obtain execution approval for the prepared exception and the temporary upload budget.
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
