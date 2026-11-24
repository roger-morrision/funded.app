# Independent second review — funded.app Solana fee-router program and integration

**Date:** 2026-11-24
**Reviewer:** Claude (AI), acting as an independent second reviewer. This is **not** an external professional security audit and must not be represented or recorded as one (see `independentReview` in `config/mainnet-program-release.json`, which this review does not fill).
**Method:** Static source review of the committed checkout, git-history diffing against prior recorded build revisions, and reading of existing evidence/docs files. No transactions were sent, no wallets were funded or connected, no keys/secrets were read, no source was edited, nothing was committed, pushed, or deployed. `funded.vip` was left on Devnet throughout; no preview/dev server was started.
**Scope:** `contracts/funded-fee-router` (program `funded-fee-router` and standalone program `developer-token-lock`) plus the server/browser integration that would invoke it.

---

## 1. Release candidate identification

**Conclusion: there is no frozen final release candidate and no independently reproducible binary-to-source match today.** This matches the project's own authoritative record, and this review independently confirms it from the repository state rather than only citing that record.

Evidence:

- Current checkout: branch `main` at `HEAD b0a24ec3` ("Provision role custody and require Mainnet eligibility archives"), clean under `contracts/funded-fee-router/programs` — the uncommitted working-tree changes (`git status`) touch only browser/UI files (`bootstrap-gate.{js,css}`, `bootstrap.js`, `index.html`, `public/bootstrap-preflight.js`, `src/app/controllers/navigation.js`, `src/features/growth/*`, `src/features/workspace/navigation.js`, `styles/pages/theme.css`), `.claude/launch.json`, `CLAUDE.md`, and `docs/mainnet-launch-readiness.md`, plus new untracked docs/tests. **None of the uncommitted changes touch program source** under `contracts/funded-fee-router/programs`. Per task instructions these were left untouched and are not part of this program review, but are noted as preserved, relevant context (the untracked `docs/mainnet-launch-readiness.md` diff and `docs/evidence/go-live-preparation-2026-11-21.json` are prior server/browser-side readiness work, not a program-source change).
- `config/mainnet-program-release.json` — the authoritative release record — has `programId`, `fundedMint`, `fundedPool`, `upgradeAuthority`, `programDataSha256`, `sourceRevision`, `binary.bytes`, `binary.sha256`, and the entire `independentReview` block all `null`, with `status: "awaiting-production-identity-and-independent-review"`. **No program is deployed on Mainnet.**
- Multiple exploratory candidate builds exist in the repository's history/evidence, none promoted to the authoritative record above, and they disagree with each other:
  - `docs/evidence/production-contract-handoff-2026-11-22.json`: `sourceRevision 971399ff4e2ebdeca76a3e16a80273db38a8bfa0`, `programElfSha256 3f8aaffc8b308df74cafe7fff22ad37e0ee2a33e28f747468804c36c66024e50`, `programElfBytes 1110424`, `deployedProgramDataSha256: null`. Its own `stillMissingForGoLive` list and `outcome` field explicitly state "Mainnet activation remains false" and that the source revision/signing references are intentionally unset.
  - `docs/mainnet-launch-readiness.md` (uncommitted, "Preparation recheck — 21 November 2026"): a **different** build, described in its own text as a "VM-only, non-deployable fixture" built "using public test identities" — 1,037,544 bytes, SHA-256 `3732459954f9e42f83c77c618c1982d60e9a97524446cfc97cacc1345ec20612` — explicitly **not** independently reviewed production bytecode.
  - Dozens more `.so` artifacts exist under `tmp/**` and `.secrets/funded-vip-deployment/candidates/**` / `.secrets/mainnet-readiness-artifacts/**` from many prior exploratory builds on different dates/branches (not enumerated individually here; `.secrets/` was not read beyond file listings, per the private-key/credential restriction). Their existence by itself corroborates that build candidates have been produced repeatedly but never frozen into the authoritative record.
- I diffed the current `HEAD` against the `971399ff…` revision recorded in the Nov-22 handoff doc for `contracts/funded-fee-router/programs`: the only functional-looking change is a one-line PDA-constraint rewrite in `reward_bitmap.rs`'s `ExpireBitmapCycle` accounts struct (seeds source changed from the caller's signer key to the vault's own stored `authority` field, and a redundant `has_one = authority` was dropped). **I verified this is not a regression** — the instruction's real authorization gate is `assert_current_router_authority()` (checked against the router's global authority, unchanged by this diff), not the vault `has_one` constraint, which was always redundant here. The rest of the diff is test-file expansion only (`app_account_setup.rs`, `protocol_guard/operations.rs`, `protocol_guard/operator_handoff.rs`, `reward_bitmap_token.rs`, `rich_assets/token_reward.rs`), not instruction logic.
- **No Rust/Cargo/Solana-SBF toolchain is available in this review environment** (Windows + Git Bash; `cargo` and `cargo-build-sbf` both report "not found"). I could not attempt an independent reproducible build from `scripts/build-mainnet-contract.sh` (which itself requires a Linux Agave 4.1.2 / platform-tools v1.54 toolchain) to confirm any of the recorded hashes above, or to hash the current `HEAD`. This is a **hard verification gap** in this review, not a judgment call — labeled **unavailable**.

**Recommendation:** before any deployment decision, someone must run `scripts/build-mainnet-contract.sh` from a clean `HEAD` on the pinned toolchain, record the resulting `sourceRevision`/`bytecode.sha256` into `config/mainnet-program-release.json`, and have an independent party repeat that build byte-for-byte. Until that happens, "the release candidate" does not exist as a single, checkable artifact — treat every hash quoted above (including the two in this section) as **unverified, self-reported evidence from prior sessions**, not evidence this review produced or confirmed.

Program identity and roles currently selected but not yet funded/active (`docs/evidence/production-contract-handoff-2026-11-22.json`, slot 472788634, observed 2026-11-23T03:16:43Z, all six accounts at 0 lamports — **local-only read, not re-verified live by this review**):

| Role | Address |
|---|---|
| Program identity | `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ` |
| Deployment payer | `E9tQpKSi29HczaYdJKbiPLf2uhYEbNhq19muExsRdmgL` |
| Admin / upgrade authority | `5ThgFz4yFPX6fQ8mdaPjtKXeYYA6RwEMjkC2vaPMA6oi` |
| Automation operator (hot key) | `AhqtNTDn7F1JVJGnSbWHtGCDFmxMunJPEgUbfPxQyz95` |
| Independent price attestor | `CDCGMm998cb5zDwmeC31KAZWukD2KKYKPsNHVjdicmEF` |
| Offline guardian | `Dmf2SqmWybu1KF4PjmqfJcfszJQq8UnS7zH8ZAYNqHQQ` |

---

## 2. Findings (prioritized)

### HIGH — Hot "automation operator" key can redirect uncapped referral-tier fee budgets to itself, without creator consent

**Files:** `contracts/funded-fee-router/programs/funded-fee-router/src/instructions/automation_v3.rs:17-30,62-76`; `.../instructions/protected_v3.rs:141-165,203-301`; `.../instructions/guard.rs:1-11,50-68` (verified directly, not only via sub-review).

`InitializeMintAutomationV3` (`automation_v3.rs:17-30`) declares `creator: UncheckedAccount<'info>` — **not** `Signer`. Its handler (`automation_v3.rs:32-56`) requires only that the supplied `creator`/`mint` match the identity already recorded in that mint's fee/agency policy (data equality, not a signature), and that `recipients[0] != default` (line 51). `recipients: [Pubkey; 4]` — one slot per category 1–4 (operations, referral tiers 1–3) — is otherwise fully chosen by whoever signs as `authority`, i.e. the router's single hot "automation operator" key.

`authorize()` (`automation_v3.rs:62-76`) is the only gate used by `approve_protected_withdrawal_v3_handler` (`protected_v3.rs:141-165`) and `disburse_protected_mint_v3_handler` (`protected_v3.rs:203-301`) for categories 1–4. It short-circuits to `Ok(())` if `creator.is_signer`; **otherwise** it accepts the call as long as the stored automation record's `recipients[category-1]` equals the given recipient — a record the authority key itself can create and populate, per above, without ever asking the creator.

`guard.rs:1-11` documents, as an explicit design note, that the router "authority" is "**a hot operator key used by automated workers**" (distinct from the cold BPF-upgrade owner and from the offline guardian), and that "operations, promotion and buyback spending share a daily SOL cap. **Verified user entitlements and reward commitments never consume this cap**." `protected_v3.rs:279-284` implements that: only `category == 1` (operations) calls `guard::record_outflow` (the daily-cap check); categories 2–4 (referral tiers) are **not** subject to any cap, delay, or creator veto beyond the `authorize()` check above.

**Concrete scenario:** for any mint that already has an initialized protected fee policy (a normal, intended product state — paid listings accrue protocol fee shares into `policy.paid_lamports[1..4]` over time), whoever controls the single automation-operator signing key can: (1) call `initialize_mint_automation_v3` with `recipients = [self, self, self, self]` if no automation record exists yet for that mint, or use an existing one if it was ever pointed anywhere reachable by that key; (2) call `approve_protected_withdrawal_v3_handler` then `disburse_protected_mint_v3_handler` for category 2, 3, or 4 with `recipient = self`. Both calls pass `authorize()` with no creator signature, and `protected_v3.rs:210-249` places no cap on the amount beyond `new_withdrawn <= policy.paid_lamports[index]` (i.e. bounded only by whatever has already accrued to that category for that mint). This repeats per-mint, uncapped, with no time delay, across every mint using the protected-fee feature.

**Mitigation present, but reactive only:** the guardian can call `set_pause(true)` (`guard.rs:164-175`), which blocks further `assert_current_router_authority`-gated calls — but it cannot reverse a disbursement that already happened, and nothing distinguishes "the automation operator is legitimately configuring real referral payout addresses" from "the automation operator key has been compromised or misused" until after the fact.

**Test coverage gap:** `tests/app_account_setup.rs:141-145` tests that a signer who is *not* the router authority is rejected (the wrong adversary model for this finding). `tests/protocol_guard/operations.rs`'s `earned_referrals_remain_payable_when_operations_cap_is_exhausted` tests the *intended* happy path (referral payouts proceeding despite the operations cap being exhausted) — it does not test, and the suite has no test for, the authority unilaterally pointing a category 2–4 recipient at an address with no real entitlement.

**Severity: High.** This is a real, uncapped fund-movement path bounded only by a single online/hot key, not Critical only because exploitation requires control of that specific operational signer rather than being reachable by an arbitrary outside party, and because the cap exemption for categories 2–4 appears to be an intentional product decision (per the `guard.rs` comment) that may not have been threat-modeled against *that specific key* being misused or compromised.

**Recommendation:** require `creator.is_signer` unconditionally for categories 2–4 (restrict the automation-record bypass to category 1/operations, which the platform already owns outright and which is cap-protected), or bring categories 2–4 under the existing daily cap, or require automation-record recipient changes to go through a guardian-reviewable delay (mirroring the 24-hour `REWARD_CYCLE_MIN_DELAY_SECONDS` pattern already used for reward cycles in `guard.rs:82-87`).

---

### MEDIUM — Mainnet RPC relay does not decode/deny transactions by target program ID

**Files:** `server/network-write-policy.mjs` (per sub-review; also `server/rpc-failover.mjs:51`, `server/rpc-gateway.mjs:174`, `server/rpc-proxy.mjs:27`) — **verified by a review sub-task reading these files directly; I did not re-read them myself, so this item is one level less directly verified than the others in this report.**

When `FUNDED_MAINNET_NON_PROGRAM_WRITES=true` (the documented production value), the relay's `rpcWriteBlocked()` stops blocking `sendTransaction` entirely — it inspects the RPC method name, not the decoded instructions' target program ID. `POST /api/solana/rpc` is also explicitly exempted from the generic path-based mutation check. Today this is inert: no fee-router program is deployed on Mainnet, and the server-side signing workers (`server/automatic-reward-chain.mjs`, `server/v3-token-keeper.mjs`) independently refuse to construct or sign fee-router-targeted transactions on `mainnet-beta` (confirmed: `financialProgramAllowed()` throws unless a deployed `ProgramData` SHA-256 match is found, `automatic-reward-chain.mjs` unconditionally refuses non-journaled signing on mainnet, and `TOKEN_CONVERSION_POOLS['mainnet-beta']` is an empty frozen object, so there is currently no legitimate transaction-construction path for this to matter). But the relay itself provides no *independent* second line of defense against a future client-constructed, program-targeting transaction once a program is deployed — its safety currently depends entirely on nothing upstream building such a transaction.

**Recommendation:** before or alongside Mainnet program deployment, add an instruction-level program-ID denylist/allowlist to the relay so it remains a real second gate rather than a no-op that happens to be safe only because nothing else is wired up yet.

---

### LOW — Documentation cites env flags that do not exist in code

`docs/mainnet-nonprogram-site-release.md` lists `FUNDED_MINT_FEE_ROUTER_ENABLED` and `FUNDED_BUYBACK_EXECUTOR_ENABLED` as observed production policy flags gating fee-router/buyback activation. A case-insensitive search of `server/` and `src/` found **no occurrence of either identifier**. The actual gating mechanism (per the Medium finding above) is `financialProgramAllowed()`/`ProgramData`-hash verification plus the empty per-cluster conversion-pool table — not these two flags. This is a documentation-accuracy gap, not a code vulnerability, but could mislead an operator who believes toggling those env vars controls activation.

### LOW — `repair.rs` router-header repair bypasses the Mainnet pause check (no exploit path found)

`contracts/funded-fee-router/programs/funded-fee-router/src/instructions/repair.rs` lets an account rewrite its own `MAGIC`/`VERSION`/`POLICY_HASH`/`bump` header fields using the authority bytes already recorded in that same account, without going through the full `assert_current_router_authority` (so it does not call `assert_not_paused`). It cannot move funds or change the stored authority, so no exploit path was identified; recommended for consistency/defense-in-depth only.

---

## 3. Areas reviewed with no issue found (actively checked, not assumed)

Each of these was read in full (via `cat -n`, after the Read tool was observed to lossily summarize large file reads as "squeez:summary" output in this session — every code citation in this report is from the raw file, not that summarized form) and cross-checked against git history where relevant:

- **Financial arithmetic & fee routing** — `settle.rs`, `buyback_v3.rs`, `buyback_curve_v3.rs`, `buyback_price.rs`, `token_fees_v3.rs`, `token_convert_v3.rs`, `agency_disburse_v3.rs`, `agency_buyback_v3.rs`, `developer_escrow.rs`: checked math (`checked_add`/`checked_sub`/`checked_mul` with `.ok_or(...)`) throughout; every CPI's actual effect is re-verified from before/after token or lamport balance deltas rather than trusted from the nominal instruction argument (the `exact_token_delivery` pattern, reused consistently); fee-share rounding uses a cumulative-boundary/largest-remainder method that sums exactly to the total with no overpay; slippage/minimum-out bounds exist on swaps; buyback/conversion spend is bounded by an explicit budget check before any transfer.
- **Reward/payout duplication or loss** — `reward.rs`, `reward_bitmap.rs`, `reward_cleanup.rs`, `community.rs`, `rich_assets.rs`: double-claim is prevented either by Anchor's `init`-only receipt-PDA idempotency (legacy/community paths) or by an explicit paid-bitmap bit checked and set before the transfer (bitmap path); Merkle leaves are domain-separated by cycle/drop id, recipient, asset mint, amount and index, so a leaf valid for one cycle cannot replay against another.
- **Replay/expiry handling** — cycle/drop expiry requires a grace period past `payout_at` (`REWARD_CYCLE_EXPIRY_GRACE_SECONDS` = 30 days on Mainnet, `constants.rs:61-62`) and can only run once per cycle (clearing `reserved` makes the condition false for any second attempt); the guardian's `cancel_reward_cycle` (`guard.rs:196-210`) uses the same non-reentrant pattern.
- **Recovery after interruption** — `recover_qa_v3.rs` is pinned to a hardcoded historical claim *and* to a Devnet-only program ID (`9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`) distinct from the Mainnet identity above, making it inert if deployed under the Mainnet program ID; `recover_wrapped_sol.rs` only moves an accidentally-wrapped balance back into the same PDA's own native-SOL custody (funds never leave program control).
- **Upgrade/admin authority** — `rotate.rs`: `assert_upgrade_owner` validates the caller against the live BPF-upgradeable-loader's program/ProgramData account bytes (not merely a stored pubkey), and `assert_current_router_authority` validates the router's own header (magic/version/policy-hash/PDA/bump) before trusting its stored authority; rotation requires old authority, new authority, and the upgrade owner to co-sign, and explicitly forbids the new hot authority also being the guardian.
- **PDA/account validation and program dispatch** — `lib.rs` entrypoints map 1:1 to handlers; the `mainnet-v3-program` feature does not also enable `devnet-v3-program` (confirmed in `Cargo.toml`), so the weaker-looking `reward_bitmap.rs` PDA pattern noted in §1 is compiled out of the Mainnet binary; `initialize.rs` and the V3 policy/rules/automation setup handlers consistently gate on `assert_upgrade_owner`/`assert_current_router_authority`.
- **Standalone `developer-token-lock` program** — lock duration is fixed per-call to one of `{21600, 43200, 86400, 172800}` seconds (plus a `300`-second value compiled in only for a Devnet-only, non-Mainnet feature combination) via `allowed_lock_seconds()`, matching `developerLockPeriodsSeconds` in `config/mainnet-program-release.json`; release is bound to the original depositor via `has_one` and a `released_at` guard prevents double release.
- **Browser/server/program integration ("non-program mode" kill-switch)** — confirmed layered and currently fail-closed by a combination of (a) the RPC relay (see Medium finding for its gap), (b) `financialProgramAllowed()`'s mainnet `ProgramData`-hash check in `automatic-reward-chain.mjs`, (c) an unconditional refusal of non-journaled mainnet signing in the same file, and (d) an empty `TOKEN_CONVERSION_POOLS['mainnet-beta']` table in `v3-token-keeper.mjs`. These do not depend on `FUNDED_MAINNET_NON_PROGRAM_WRITES` at all — they hold even if that flag were mis-set, because there is currently nothing deployed for them to match against.

---

## 4. Test results and gaps

- **No Rust/Cargo/Solana-SBF toolchain is available in this review environment** (confirmed: `cargo`/`cargo-build-sbf` both "not found" on this Windows/Git-Bash machine). **None of the program's own tests were executed** — `tests/app_account_setup.rs`, `tests/protocol_guard/{operations,operator_handoff}.rs`, `tests/reward_bitmap_token.rs`, `tests/reward_cycle_expiry.rs`, `tests/rich_assets/*`, `tests/cpi_buyback.rs`, `tests/cpi_conversion.rs`, `tests/developer_escrow.rs`, `tests/fresh_loader_deploy.rs` were all read for context (test names, assertions) but not run. **Label: unavailable.** Every Rust-side finding and "no issue found" conclusion above is from static reading alone, not from executing the project's own test suite.
- `npm run check` (syntax + size budget) completed after this review's main analysis: **passed** — 1,233 JavaScript files syntax-checked with no errors, and source-size budgets passed for 1,500 maintained code files (hard maximum 1,000 lines/file). **Label: verified, local-only.** This covers syntax/size hygiene only — it is not a security or correctness check and does not bear on any finding in §2.
- `node --test tests/*.test.mjs` (~560 unit tests), `npm run review:local`, `test:smoke`, and `review:flows/consistency/layout/pages` were **not attempted** — they require a running local server and/or reachability to `https://richpad.fun`, which is outside a static program/source review and outside this task's "no deploy, no transactions" constraint. The integration sub-review's conclusions about the Mainnet kill-switch are therefore **static-code-reading evidence only**, not evidence from observing the running app actually refuse a Mainnet-targeted transaction.
- No test wallets, transactions, or RPC calls of any kind were made anywhere in this review; no network access occurred.

---

## 5. Readiness conclusion

**Not ready for Mainnet program deployment.** This is consistent with the project's own authoritative gating (`config/mainnet-program-release.json` already records no deployed program, no bound program identity, and no completed independent review), and this review adds to that:

1. Confirmation, from the repository state itself rather than only from the docs, that **no single frozen, reproducible release candidate exists** — several mutually inconsistent exploratory candidate hashes exist (two cited in §1 alone), none promoted to the authoritative record, and this review could not independently rebuild or hash-verify any of them (no SBF toolchain available here).
2. One **High**-severity authorization-boundary finding (automation-operator key / referral-tier categories 2–4, §2) that should be fixed, or explicitly risk-accepted by the team with eyes open, before real money flows through the protected-fee path.
3. One **Medium** relay-hardening recommendation and two **Low** documentation/hardening notes (§2).
4. Confirmation that the rest of the reviewed surface — financial arithmetic, most authorization/PDA validation, replay/expiry handling, recovery instructions, upgrade authority, and the current non-program-mode kill-switch — held up under static adversarial reading, **with the caveat that none of it was exercised by actually running the test suite or a reproducible build in this session.**

## 6. Remaining handoff to an independent human auditor

This AI review does not satisfy, and must not be recorded against, the `independentReview` field in `config/mainnet-program-release.json`. Before Mainnet deployment, a human reviewer with Solana/Anchor security experience should additionally:

1. Perform the reproducible build (`scripts/build-mainnet-contract.sh`, pinned Agave 4.1.2 / platform-tools v1.54) from a clean `HEAD`, and have a second party repeat it byte-for-byte, before any hash is written into `config/mainnet-program-release.json`.
2. Independently assess the automation/protected-withdrawal finding in §2 and decide on a fix or an explicit, documented risk acceptance.
3. Run the full `cargo test` suite under `contracts/funded-fee-router` and the project's `node --test`/`review:local`/smoke suites against the exact candidate, with results attached to the release record — none of this review's conclusions have that execution evidence behind them.
4. Review live key-custody and operational practice for the five wallet roles in §1 (this review covers code only, not how those keys are actually generated, stored, or operated).
5. Fill `config/mainnet-program-release.json`'s `independentReview.reviewer`/`reference`/`sourceRevision`/`binarySha256` fields once the above is complete.

No contact with, or engagement of, any external auditor was made or attempted as part of this review.
