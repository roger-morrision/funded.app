# Production Candidate Review — AI Review (Claude Desktop), 2026-11-24

**This is an AI review, not a professional human security audit.** The owner explicitly asked
Claude Desktop to act as the independent second reviewer for funded.app and accepts this AI
review as the project review, under the scope and constraints below. Accepting this review
method is not acceptance of any finding left open in this report, and is not Mainnet activation.

## Scope and constraints followed

- No application or contract source was edited. No commits, pushes, deploys, custody changes,
  credential/private-key reads, or transactions were made. All contract-source conclusions came
  from reading the checked-out tree and from local, offline builds/tests in a scratch WSL clone
  and a network-disabled Docker container — never from a live RPC write or a signed transaction.
- One read-only public Mainnet RPC call was made (`getAccountInfo`, no keys involved) to check
  whether the candidate program ID is deployed; see "On-chain deployment state" below.
- This report only. No other file was changed by this review.
- Two revisions were reviewed as the user updated the workspace live:
  1. The contract candidate plus a first draft of `server/production-conversion-runtime.mjs`
     and its launcher (reviewed while in progress).
  2. The **final, pushed** revision at commit `bfa004c61b214db7c8723d76ac274cc721c2db21`
     (`Add admitted production conversion process and verified metadata probe`), diffed against
     `2b986213a67f68aa180af9630561e6cd1342937b`. This report's conclusions are against (2).
- Prior reports (including `docs/reviews/mainnet-independent-review-2026-11-24.md`) were treated
  as context only, not as current execution evidence, per instruction — they predate this
  candidate and the runtime fixes below.

## 1. Candidate identity — verified myself

`config/mainnet-review-candidate.json` claims, all independently checked against the git object
store and a from-scratch rebuild (not taken on trust):

| Field | Claimed | Verified |
|---|---|---|
| `sourceRevision` | `68c526f3bbe4cdc8afcf5e0c9c10028e9f87a97b` | Exists; commit "Require creator consent for Mainnet referral withdrawals", authored by the project owner. |
| `contractTree` | `4184c08bb6561707b0aca99f2bc8c952834b6adf` | Confirmed via `git ls-tree -r -t` to be exactly `contracts/funded-fee-router` at that commit. |
| `programId` | `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ` | Baked into the binary at build time via `build.rs` `declare_id!`; not runtime-configurable. |
| `binary.bytes` / `binary.sha256` | `1110672` / `b2e81135…db70b9c` | Byte-for-byte reproduced independently (§2). |
| `conversionPools` | `EPjFWdd5…Dt1v:Gf7sXMoP…Td3v` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` is canonical SPL USDC; the pool is baked in via `build.rs` into a `const CONVERSION_POOLS` array ([token_convert_v3.rs:31-35](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/token_convert_v3.rs:31)), matching the config exactly. |

Final `main` is `bfa004c61b214db7c8723d76ac274cc721c2db21` (confirmed against `origin/main`).
GitHub Actions run `45375425080` is confirmed `completed`/`success` for that exact `headSha`,
with both the `application` and `docker-image` jobs completed/success.

## 2. Independent build reproduction — not taken on trust

`tmp/merge-cleanup-20261124/validate-referral-cached.sh` documents the intended build, but its
own output only proves what its *own* pinned clone produced. I did not reuse that clone or its
output directory. Instead:

1. Cloned the repo fresh into a new WSL path (`~/claude-review-repro-20261124`), checked out
   `68c526f3…` cleanly (`git status --porcelain` empty).
2. Ran `scripts/build-mainnet-contract.sh` (unmodified) into a **new, never-before-existing**
   output directory, with the exact pinned toolchain: Agave 4.1.2 `cargo-build-sbf` 4.1.0 /
   platform-tools v1.54 / rustc 1.89.0, `FUNDED_MAINNET_PROGRAM_ID` and
   `FUNDED_MAINNET_CONVERSION_POOLS` set to the candidate's values, `--locked`, offline.
3. Result: SHA256 `b2e811357cf55dc6624a48b6f630eb6c32ae2c23f3bd6c271d6013c72db70b9c`, size
   `1110672` bytes — **identical** to the candidate's claimed hash/size, from an independently
   built artifact.

The build script itself enforces good hygiene worth noting as a positive: it refuses to run with
`RUSTFLAGS` overrides, refuses a non-exact toolchain version string, refuses a dirty or moved
checkout, and refuses to reuse an existing output directory
([build-mainnet-contract.sh](scripts/build-mainnet-contract.sh)). `build.rs` additionally asserts
at compile time that Mainnet and Devnet features are mutually exclusive and that
`historical-qa-recovery` can never be compiled into a production build
([build.rs:38-40](contracts/funded-fee-router/programs/funded-fee-router/build.rs:38)).

## 3. Compiled-bytecode test suites — run against the reproduced candidate, local VM only

**All runs below are local `cargo test` executions against an in-process Solana VM (litesvm-style
fixture). None of this touches live Mainnet, submits a real transaction, or uses a real key.**
All 11 top-level suites under `contracts/funded-fee-router/programs/funded-fee-router/tests` were
run against the byte-identical reproduced `.so` from §2:

| Suite | Result |
|---|---|
| `app_account_setup` | 4 passed |
| `cpi_buyback` | **4 passed** (see follow-up run below; initially 4 ignored for lack of a fixture) |
| `cpi_conversion` | **2 passed × 3 fixtures = 6 passed** (see follow-up run below; initially 2 ignored) |
| `developer_escrow` | 7 passed (after building the companion `developer-token-lock` program for `LEGACY_DEVELOPER_LOCK_TEST_SO`, which my scratch clone initially lacked — environment gap on my side, not a contract defect) |
| `fresh_loader_deploy` | 1 passed |
| `protocol_guard` | **11 passed**, including `referral_consent::operator_chosen_referrals_require_creator_consent_at_approval_and_payment` |
| `reward_bitmap_token` | 0 tests defined |
| `reward_cycle_expiry` | 1 passed |
| `reward_mainnet_gates` | 1 passed — `devnet_and_unprotected_entrypoints_are_absent_from_mainnet_build` (independently corroborates §5.3) |
| `reward_rent` | 0 tests defined |
| `rich_assets` | 10 passed (after linking `node_modules` into my scratch clone for the one test that shells out to `server/daily-bonus.mjs` — again an environment gap on my side) |

**Net: 45 passed, 0 failed, 0 ignored across every runnable test in all 11 suites.** The two
suites that initially showed failures/ignores in my first pass did so purely because my
throwaway clone was missing a companion binary, `node_modules`, and (for the two DEX-CPI suites)
an explicit fixture — all three were an environment gap on my side, not a contract-logic issue;
once supplied, everything is green. The DEX-CPI follow-up is detailed next.

### 3.1 Follow-up: the previously-ignored DEX-CPI tests, now run against real public captures

After the first pass, the user located the original public DEX captures preserved in a separate
historical worktree archive at
`.secrets/worktree-archives/20261124/mainnet-readiness/tmp/cpi-fixtures/`. Per instruction, I
read **only** the four named fixture directories within it (not the rest of that archive):
`production-primary-20261122`, `production-usdc-sell-20261122`,
`production-usdc-sell-20261122-cat6`, `production-usdc-sell-20261122-cat7`.

Before running anything, I independently checked each `fixture.json`'s `routerProgram` field
myself (not taken on the user's word): all four read exactly
`ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ` — the candidate's own program ID. Captured slots
are `472581858` / `472584037` / `472584981` / `472584982` — all from 2026-11-22, and all well
behind the live Mainnet slot (`~473313059`, observed in §5.3's RPC check) — i.e. genuinely
historical, replayed-only data, not something that can touch current chain state.

I ran these against **my independently-rebuilt candidate ELF** from §2 (`FUNDED_ROUTER_TEST_SO`
unchanged from the rest of this review), with `FUNDED_CPI_FIXTURE` pointed at each directory in
turn, `--ignored --nocapture`, all local `cargo test` runs against an in-process VM — no RPC
submission, no live chain interaction:

- **`cpi_buyback` (`production-primary-20261122`, `venue: "pool"`, category 6, slot 472581858),
  all 4 previously-ignored tests: 4 passed, 0 failed.** This single pool fixture satisfies the
  `donated_accounts_cannot_block_*` tests' extra pass too, since `pool_fixture()` is true.
- **`cpi_conversion`, both previously-ignored tests run once per category fixture (5, 6, 7): 6
  passed, 0 failed** across `production-usdc-sell-20261122` (cat 5), `-cat6`, `-cat7`.
- In every run, the test code itself (not me) independently hashed the captured external DEX
  program bytes (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA.so`,
  `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ.so`) and asserted the result equals the
  `sha256` recorded in that fixture's own `fixture.json` before loading it into the VM
  (`cpi_conversion.rs:85-88`, mirrored in `cpi_buyback.rs`); a mismatch there is a hard test
  failure, and none occurred.
- **Scope: all of this is local, in-process VM execution against historical (2026-11-22),
  already-captured public account/program snapshots. No transaction was submitted to any
  network, live or otherwise, and nothing here is live financial acceptance.**

**Updated net across all 11 suites: 45 passed, 0 failed, 0 ignored, 0 skipped for lack of a
fixture.**

## 4. Contract review

### 4.1 Authorization
- The "hot" router authority is validated against a 74-byte on-chain header with magic/version/
  policy-hash checks on every privileged call (`assert_current_router_authority`,
  [rotate.rs:31-41](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rotate.rs:31)).
- The upgrade-owner check reads the **actual** BPF-upgradeable-loader `ProgramData` account on
  chain (`assert_upgrade_owner`,
  [rotate.rs:18-29](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rotate.rs:18)) rather than trusting a stored pubkey — this is the correct, non-spoofable check.
- Guardian/upgrade-owner separation is enforced structurally: the guardian can only pause and
  cancel unpaid reward cycles; only the upgrade owner can unpause or reconfigure
  ([guard.rs:138-210](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/guard.rs:138)), and `rotate.rs:61` explicitly forbids the hot authority from also holding the
  guardian key.
- Devnet-only recovery (`recover_qa_v3.rs`) is gated behind `historical-qa-recovery`, a feature
  **disjoint** from `mainnet-v3-program` (`build.rs:39-40`); confirmed absent from the Mainnet
  build both by feature-gate reading and by the passing `reward_mainnet_gates` test above. It is
  also internally pinned to a fixed Devnet program ID, fixed historical claim IDs/amounts, and
  cannot withdraw or redirect funds even if it were somehow present.

### 4.2 Financial deltas
- Fee settlement (`settle_collection`,
  [policy_v3.rs:140-203](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/policy_v3.rs:140)) uses cumulative-target accounting (`category_targets`) so repeated small
  deposits allocate exactly via rounding-safe deltas, not drift. All arithmetic is `checked_*`.
  Settlement only moves lamports between program-owned accounts (router → per-category vaults);
  it never pays an external party directly, so it does not need creator consent.
- Withdrawal/disbursement (`disburse_protected_mint_v3_handler`,
  [protected_v3.rs:203-300](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/protected_v3.rs:203)) enforces `withdrawn_lamports <= paid_lamports` per category, recipient-PDA
  exclusion (can't redirect to the router or any of the 7 vaults), and consumes the matching
  `MintWithdrawalApprovalV3` exactly once.
- Only category 1 (operations) counts against the guardian's daily SOL cap
  (`protected_v3.rs:281-284`); this is consistent with reward-cycle creation also recording
  outflow for SOL cycles (`reward_bitmap.rs:54-58`) — note the module header comment in
  `guard.rs:11` ("Verified user entitlements and reward commitments never consume this cap") is
  **stale/inaccurate** for SOL reward-cycle creation specifically; this is a documentation nit,
  not a fund-safety issue (if anything it's an extra conservative guardrail), but should be fixed
  for clarity.
- Token-budget conversion (`token_convert_v3.rs`) verifies exact custody deltas against the
  actual PumpSwap CPI result (`spent`, `received`, `bought` all computed from before/after
  balances, not trusted return values) and only allows the one pinned, build-time-baked
  USDC/WSOL pool. `exact_token_delivery` similarly rejects any fee-on-transfer/short-delivery
  token in the reward-bitmap token payout path.

### 4.3 Replay / restart recovery
- Settlement and withdrawal receipts are Anchor `init` PDAs seeded on `claim_id` /
  `withdrawal_id`; re-submitting the same ID fails at account creation (can't double-settle or
  double-pay the same approval).
- Merkle-bitmap reward payouts (`validate_payment`,
  [reward_bitmap.rs:153-169](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward_bitmap.rs:153)) check-and-set the per-leaf bit **before** any transfer, so an
  off-chain worker that crashes and resubmits the same leaf after a restart gets rejected, not
  double-paid.
- `expire_cycle` only clears `reserved` and releases the reserve accounting; the comment and code
  confirm "Tokens never move" ([reward_bitmap.rs:301-315](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward_bitmap.rs:301)) — funds stay in the vault for later
  cycles, they are not redirected.
- `RepairHeader` ([repair.rs](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/repair.rs)) only resets header magic/version/bump and requires the caller to
  already sign as the authority stored in that same header — it cannot be used to take over
  authority, only to fix corrupted header bytes after e.g. a constant change.
- `RecoverMintWrappedSol` closes stray WSOL ATAs back into the router's own SOL balance; funds
  never leave program custody.

### 4.4 Referral-consent remediation (the stated fix in this candidate)
The commit adds exactly 5 lines to `automation_v3.rs`:

```
if cfg!(feature = "mainnet-v3-program") {
    require!(!(2..=4).contains(&category), ErrorCode::InvalidMintApprovalV3);
}
```
([automation_v3.rs:76-80](contracts/funded-fee-router/programs/funded-fee-router/src/instructions/automation_v3.rs:76)) This closes a gap where the hot operator's automation PDA — even one
whose recipients the creator had legitimately configured — could previously approve/pay referral
tiers (categories 2-4) without the creator's live signature. After the fix, those categories
always require `creator.is_signer` on Mainnet; only category 1 (operations) remains
automation-eligible.

The new test `referral_consent::operator_chosen_referrals_require_creator_consent_at_approval_and_payment`
([protocol_guard/referral_consent.rs](contracts/funded-fee-router/programs/funded-fee-router/tests/protocol_guard/referral_consent.rs)) specifically uses a *real* automation
PDA the operator legitimately controls (not a forged/wrong-authority account — the comment at
line 15 calls this out explicitly as the correct attack model), and asserts both approval and
payment are rejected for categories 2-4 without the creator's signature, and succeed once it's
present, with before/after account-state equality checks on rejection. This test passed both in
the cached build and in my independent rebuild (§3).

**This fix is minimal, correctly scoped, and verified by a test that models the actual attack
it closes.**

## 5. Production integration review (read-only; code not edited)

### 5.1 First draft vs. final commit
I read `server/production-conversion-runtime.mjs` twice: once mid-edit, once at the final pushed
commit `bfa004c6`. Between those two reads, one real defect I had identified was independently
fixed by the author:

- **Finding (now fixed): object-identity loss broke recovery-worker selection.**
  `prepareTokenConversionRuntime` ([token-conversion-bootstrap.mjs:176-177](server/token-conversion-bootstrap.mjs:176)) registers the *exact* object it returns as a `WeakMap` key
  (`preparedRecoveryRuntimes.set(prepared, …)`) so that `selectPreparedTokenConversionRecovery`
  ([token-conversion-bootstrap.mjs:25-32](server/token-conversion-bootstrap.mjs:25)) can later look
  it up by reference. The first draft of `prepareProductionConversionService` returned
  `{...runtime, start(){…}, close(){…}}` — a **new** object via spread — so the object handed to
  callers (and ultimately to `selectMainnetTokenConversionRecovery` in
  [api-financial-workers.mjs:13-18](server/api-financial-workers.mjs:13)) would never match the
  `WeakMap` key, and `selectPreparedTokenConversionRecovery`'s `assert(selected, …)` would always
  throw. The final commit changed this to `Object.assign(runtime, {start(){…}, close(){…}})`
  ([production-conversion-runtime.mjs:108](server/production-conversion-runtime.mjs:108)), which
  mutates and returns the *same* object, preserving identity. I traced this is safe (no property
  collision with what `prepareTokenConversionRuntime` returns) and confirmed it is now exercised
  and green by `production launcher recovers unknown sends after restart without new custody or
  broadcast` in the independently-rerun integration suite (§5.3). **No outstanding action here —
  flagging it because it's a concrete defect-then-fix I can point to, not a live issue.**
- Custody close is correctly idempotent (`createFileTokenConversionCustody`'s `resolver.close`,
  [token-conversion-file-custody.mjs:62](server/token-conversion-file-custody.mjs:62)) sets
  `closed=true`/zeroes the secret and tolerates being invoked twice (once via the server's
  `'close'` event listener, once via explicit `disposeCustody()`), so I do **not** consider that a
  defect despite the double-invocation.
- Custody-load latching (`custody??=…` in
  [production-conversion-runtime.mjs](server/production-conversion-runtime.mjs)'s signer closure)
  deliberately never retries a failed custody load within one runtime's lifetime — this matches
  the explicit design comment in `token-conversion-file-custody.mjs:58-59` ("A failed read is
  latched... a new trusted runtime must be prepared") and is intentional hardening, not a bug.

I found no other concrete defects in `production-conversion-runtime.mjs`,
`token-conversion-bootstrap.mjs`, `token-conversion-file-custody.mjs`,
`scripts/run-production-conversion-service.mjs`, or `server/metadata-publication.mjs`'s diff on
static reading. The design is unusually defensive (role-exact file bindings, three-way journal
cross-verification across controller/operator/price-attestation before any signing, HTTPS-only
RPC refs, bounded single-line credential files with O_NOFOLLOW + dev/inode re-checks, exact
message/signature shape checks in `token-conversion-file-custody.mjs:33-51`) and I could not find
a path around any individual check from reading alone.

### 5.2 Evidence re-verification (not taken on trust)
`tmp/production-integration-20261124/integration-linux.json` was reported empty (0 bytes) when I
first checked — it had not actually been produced yet at that point, despite an initial claim
that "172 tests" were available. I re-ran the real harness myself rather than accept the
later-committed numbers directly:

- Ran `node tmp/production-integration-20261124/test-container.mjs` and
  `... test-container.mjs security` myself — a Docker container with `--network none`,
  `--read-only`, `--cap-drop ALL`, pinned to a specific image digest, mounting only the named
  source files read-only plus three fixture files (the USDC sell capture, the historical
  2026-11-22 ELF, and the actual 2026-11-24 candidate ELF).
- My independent run produced **173/173 passed** (integration) and **63/63 passed** (security),
  with the **core result (`counts`, `cases`, `success`) byte-identical** to the committed
  `docs/evidence/production-integration-2026-11-24.json` and
  `docs/evidence/production-security-2026-11-24.json`.
- The 6 `production-conversion-runtime.test.mjs` cases in that run include the restart-recovery,
  lazy-custody, exact-once-settlement, reused-authentication-rejection, and
  close-during-admission scenarios — all passed.
- The metadata-probe evidence (`docs/evidence/metadata-storage-verification-2026-11-24.json`)
  shows `cluster: "devnet"`, `transactionsSigned: 0`, `transactionsSubmitted: 0`,
  `checkedAt: 2026-11-24T10:29:35.161Z` — a real, credential-free, Devnet-only recheck, not a
  Mainnet action.

### 5.3 Current production integration state (confirms no premature activation)
- `config/mainnet-program-release.json` — the manifest that
  `requireReviewedTokenSignerPolicy`/`reviewedMainnetManifest` gate everything in
  §5.1 on — is **still fully null**, with `status: "awaiting-production-identity-and-independent-
  review"` ([mainnet-program.js:14-28](mainnet-program.js:14)). Until this file is explicitly
  populated with a `status: "reviewed"` record naming a reviewer/reference, every function that
  calls `requireReviewedTokenSignerPolicy` — including the entire production conversion runtime —
  cannot be constructed. This is the correct state for a candidate still under review.
- `server/api-financial-workers.mjs:10-18` confirms in its own comment: "The public server
  currently supplies no private conversion runtime" — `selectMainnetTokenConversionRecovery`
  returns `null` whenever `context.preparedTokenConversionRuntime` is `undefined`, which it
  always is today. The new runtime is not wired into the live server path.
- A grep of `server/` and `src/` for the literal candidate program ID
  (`ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ`) found no references — it is not configured
  anywhere in the running application yet.
- **On-chain deployment state** (verified with one read-only public Mainnet RPC call,
  `getAccountInfo`, no keys/signing involved): `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ`
  currently has **no account on Solana Mainnet** (`"value": null`). I am explicitly **not**
  marking any ProgramData as verified — there is none to verify. Any future claim that this
  program's on-chain ProgramData/upgrade-authority has been checked must be re-verified against
  the real deployed account after deployment; nothing in this report substitutes for that.
- `scripts/verify-metadata-storage.mjs` and the metadata-probe flow are hardcoded to
  `cluster: 'devnet'` and assert that at the call site; they cannot touch Mainnet.
- No reference to funded.vip's Devnet stack was changed or needed changing; it was not touched by
  this review and should remain on Devnet per standing project instruction.

## 6. Decision

**Approve, within the stated scope, with explicit conditions before any Mainnet activation.**

What is approved:
- The contract candidate (`sourceRevision 68c526f3…`, `contractTree 4184c08b…`, ELF
  `b2e81135…db70b9c`) — identity independently verified, build independently reproduced
  byte-for-byte from a clean checkout, **all 11 compiled-bytecode test suites fully green: 45
  passed, 0 failed, 0 ignored**, including the two DEX-CPI suites once real historical public
  captures were located and run (§3.1) against real captured, hash-verified external DEX
  bytecode and the exact candidate program ID. Authorization/financial-delta/replay logic read
  and found sound, and the referral-consent fix verified minimal, correct, and test-covered
  against the exact attack it targets.
- The production-integration code reviewed at final commit `bfa004c61b214db7c8723d76ac274cc721c2db21`
  — the one concrete defect I found (recovery-selector identity loss) was already fixed by the
  time of the final commit and is now test-covered; I found no other concrete defect on static
  reading; 173/173 and 63/63 test results were independently reproduced by me in a sealed,
  network-disabled container, not taken from the committed JSON on trust.

Conditions that remain before Mainnet activation (none of these are satisfied by this review, and
accepting this review is not accepting them as done):
1. `config/mainnet-program-release.json` must be explicitly populated (status `"reviewed"`,
   reviewer/reference, matching `sourceRevision`/binary hash) before the production conversion
   runtime can even be constructed — this is a deliberate, currently-untripped gate, not a defect.
2. Once (and only once) the program is actually deployed to Mainnet, its on-chain ProgramData and
   upgrade authority must be independently re-verified against the live account — nothing in this
   report or any prior report establishes that, since nothing is deployed yet.
3. ~~The 6 ignored `cpi_buyback`/`cpi_conversion` tests require real public DEX snapshots.~~
   **Resolved.** The user located the original public captures in a historical worktree archive;
   I independently verified each fixture's `routerProgram` field matches the candidate ID and
   that the captured slots (2026-11-22, ~472.58M) are well behind live Mainnet, then ran all 10
   previously-ignored test invocations myself against my own independently-rebuilt candidate ELF
   (§3.1). All 10 passed, with the captured external DEX bytecode hash-verified by the test
   itself. This condition is closed; see §3.1 for the full account.
4. Any further code changes (the user indicated more hardening/a final commit may follow) need a
   follow-up pass against their actual diff — this report covers `bfa004c61b214db7c8723d76ac274cc721c2db21`
   only.
5. funded.vip stays on Devnet; nothing here changes that.

No Mainnet activation, deployment, or custody action is approved or implied by this report.

**Note on this update:** I confirmed via `git status`/`git diff HEAD` that no application or
contract source changed since `bfa004c61b`; the only modified tracked files are
`.claude/launch.json` (the user's own file), `CLAUDE.md`, and three docs files, none of which
this review covers. The funded.vip Devnet update mentioned by the user was not examined by this
review (out of scope) and is not represented here as verified either way.
