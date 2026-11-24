# Production admission follow-up review — AI review (Claude Desktop)

**This is an AI review, not a professional human security audit.** It is a scoped,
owner-requested follow-up to [`docs/reviews/production-candidate-claude-2026-11-24.md`](./production-candidate-claude-2026-11-24.md),
covering only the ten paths listed below. It does not re-open or re-decide that
earlier report's scoped decision on the contract candidate.

## Scope and constraints

- Bound to commit `7e66010202f87e759a8084de57c3811062932a15` ("Verify fresh
  runtime admission and nonprogram application flows"), baseline
  `7fe21520dd537a332467ed2f627dde4283590cdc`.
- Restricted to exactly ten paths (listed in §1). No contract code was read or
  re-reviewed as part of this follow-up; no application source, existing
  report, or unrelated dirty file was edited; nothing was committed, pushed,
  or deployed.
- No Playwright run, no secret read, no signing, no on-chain transaction
  submission. All verification was either static reading of the diff or
  execution of the project's own offline Node unit tests directly on this
  Windows host (no network, no custody, no keys).

## 1. Change identity

The owner first asked for review of this change as an uncommitted working-tree
diff against `7fe21520dd537a332467ed2f627dde4283590cdc`. Partway through, the
owner reported it had since been committed and pushed as `7e66010202f87e759a8084de57c3811062932a15`
and asked the report to bind to that commit instead. I verified this myself
rather than taking the claim at face value:

- `git log -1 7e66010202f87e759a8084de57c3811062932a15` resolves to exactly that
  commit, authored by Roger, subject "Verify fresh runtime admission and
  nonprogram application flows."
- `git diff 7fe21520dd537a332467ed2f627dde4283590cdc 7e66010202f87e759a8084de57c3811062932a15`
  restricted to the ten scoped paths is **byte-for-byte identical** to
  `git diff 7fe21520dd537a332467ed2f627dde4283590cdc` (the working-tree diff I
  had already reviewed) for those same paths — confirmed with a direct `diff`
  of the two patches, not just a line-count comparison.
- `git status --porcelain` after the commit shows only unrelated files still
  dirty (`.claude/launch.json`, `CLAUDE.md`, `src/features/home/featured-view.js`,
  `src/features/shared/network-disclosure.js`, `styles/network-disclosure.css`,
  plus a few untracked `docs/` files) — none of the ten scoped paths. These
  were left untouched, as instructed.

Diffstat for the ten scoped paths, `7fe21520` → `7e660102`:

| File | Change |
|---|---|
| `scripts/mainnet-candidate-observation.mjs` | new, 85 lines |
| `scripts/verify-mainnet-candidate-online.mjs` | new, 30 lines |
| `scripts/run-production-conversion-service.mjs` | modified, 1 line changed |
| `server/token-conversion-bootstrap.mjs` | modified, +16/-1 |
| `server/token-conversion-controller.mjs` | modified, +5/-1 |
| `server/token-conversion-signing-service.mjs` | modified, +5/-1 |
| `tests/security/mainnet-candidate-observation.test.mjs` | new, 64 lines |
| `tests/security/production-conversion-runtime.test.mjs` | modified, +20 |
| `config/production-integration-tests.json` | +1 line |
| `config/security-tests.json` | +9 lines |

No contract (`contracts/funded-fee-router/...`) files are touched by this
change, consistent with the owner's statement.

## 2. File-by-file review

### `scripts/mainnet-candidate-observation.mjs` (new)

Pure read-only observation of the candidate program against live chain state.
`validateCandidateSelection` checks the candidate/plan/binary shapes
(`deployEligible===false`, 40-hex-char revision/tree, genesis hash, program ID
cross-references, exact ELF length+SHA-256+ELF-magic match) before any network
call. `observeCandidateOnConnection` then:

- Reads genesis hash first and short-circuits to `blocked` on a chain
  mismatch, before spending a read on accounts (confirmed by the included
  test's `calls.reads` assertions, and matches my own re-trace).
- Fetches `getSlot('finalized')`, then reads the `Program` and `ProgramData`
  accounts **together** via one `getMultipleAccountsInfoAndContext` call with
  `minContextSlot` pinned to that slot — this is deliberate: a single call
  guarantees both accounts come from the same bank, which two sequential
  `getAccountInfo` calls would not guarantee across a landed upgrade.
- Verifies the `Program` account points at the derived `ProgramData` PDA, that
  the `ProgramData` header's upgrade authority equals the plan's
  `upgradeAuthority`, that the account bytes from offset 45 exactly equal the
  candidate ELF, that any bytes beyond that are zero, and that the recorded
  deployment slot is strictly behind the observed finalized context slot.
- `observeMainnetCandidate` requires exactly two independently supplied
  connections and only reports `verified-candidate` when **both** agree and
  their `ProgramData` hashes match; a disagreement between the two (one
  verified, one not) resolves to `blocked`, not an optimistic pass — correct
  fail-closed behavior.
- `observeDeploymentFunding` is a separate read-only rent/balance read
  (`getBalanceAndContext`, `getMinimumBalanceForRentExemption` for Program/
  ProgramData/Buffer account sizes); it reports `bufferRentLamports`
  separately from the locked-rent total, which is correct since a buffer
  account's rent is reclaimed after upgrade/deploy completes and isn't a
  persistent lock like the Program/ProgramData accounts' rent.

I cross-checked `validateCandidateSelection`'s assertions against the actual
current `config/mainnet-review-candidate.json` and `config/mainnet-deployment-plan.json`
on disk (not just the test's synthetic fixtures): `deployEligible: false`,
`genesisHash`/`upgradeable: true`/`mainnetActivationAuthorized: false`,
`mainnetProgramId` and `upgradeAuthority` matching `selectedPublicIdentities.program`/`adminUpgrade`
all hold today, so the script is not dead-on-arrival against current config
drift.

No signing, no `sendTransaction`/`sendRawTransaction`, no private key material
anywhere in this file. It matches the owner's description: read-only
observation, not release admission.

*Minor, non-blocking observation:* the `zeroPadding` check assumes any bytes
in the account beyond the candidate ELF are zero. That holds for this
program's **first** deployment (freshly allocated account data is
zero-initialized by the runtime, and the program is currently observed
`not-deployed`), which is the only scenario this review needs to cover today.
It would be worth re-checking this assumption specifically if this script is
later reused to verify a size-*decreasing* upgrade of an already-deployed
program, where trailing bytes from a larger prior version could in principle
remain — not a defect in the current diff or its current use.

### `scripts/verify-mainnet-candidate-online.mjs` (new)

Thin CLI wrapper: loads the candidate/plan files, the local candidate ELF, and
a *dedicated* RPC reference file via the existing `readProductionReference`
(bounded, canonical-file, single-line reader already reviewed in the prior
report). It explicitly rejects reusing `api.mainnet-beta.solana.com` /
`api.mainnet.solana.com` as the "dedicated" reader, then pairs it with the
public endpoint as the second, independent connection — so the two-connection
cross-check in `observeMainnetCandidate` is never satisfied by the same
endpoint twice. It rejects non-HTTPS and URLs carrying userinfo or a fragment.
Output is written only to a **new** file (`{flag:'wx'}`, refusing to overwrite
an existing path) and echoed to stdout. I checked the returned `report` shape
end-to-end: it never includes the RPC endpoint string itself, so a
dedicated-RPC URL that embeds an API key is not echoed into the review
artifact or the console. Exit code is non-zero unless `status==='verified-candidate'`.
This is a safe, read-only script; no transaction path exists in it.

### `scripts/run-production-conversion-service.mjs` (modified)

The only change: `check` mode now reports `await runtime.inspectAdmission()`
instead of the `runtime.admission` snapshot that was captured once, at
preparation time, before this change. This is a genuine fix, not just a
rename — the old `check` command would report an admission snapshot that
could be arbitrarily stale relative to the moment the operator actually runs
`check`. I confirmed `inspectAdmission` is present on the object `check` mode
calls it on: `prepareProductionConversionService` (`server/production-conversion-runtime.mjs`,
unchanged by this diff) returns `Object.assign(runtime, {start, close})`,
which preserves the `inspectAdmission` property already present on the
`runtime` object from `prepareTokenConversionRuntime`. `inspectAdmission`
needs no prior `initialize()` call, so calling it directly in `check` mode
(which never starts a listener) is correct.

### `server/token-conversion-bootstrap.mjs` (modified)

Adds `inspectAdmission`, a closure returning a coalesced-but-never-cached
promise: concurrent calls share one in-flight check (`inspecting ??= (...)`),
but the variable is cleared via `.finally()` regardless of outcome, so the
*next* call always re-verifies from scratch — matching the code comment and
the owner's requirement that this never reports a stale "already admitted"
result. Each call does exactly two things:

1. `verifyContext(!recoveryOnly)` — a fresh read of chain genesis, finalized
   slot, the fee-router account, and the price-config account, returning
   (among other fields) `freshSigningEligible` computed from the just-read
   guard/operator/price-signer state.
2. `verifyJournalSet()` — re-reads and cross-validates **all three roles'**
   journals (controller, operator, price-attestation) via `storeFactory`,
   regardless of which role this particular runtime instance represents.

Neither function touches `loadCustody` or any signer. `inspectAdmission` is
threaded through to both `createTokenConversionController` and
`createTokenConversionSigningService`, and exposed on the returned `prepared`
object. This matches the "verify chain and all role journals after
authentication, without loading custody or signing" requirement exactly.

### `server/token-conversion-controller.mjs` / `server/token-conversion-signing-service.mjs` (modified)

Both add an identical `GET /admission` branch, placed immediately after the
`authorized(req)` check (so it is unreachable without a valid bearer token)
and — important for the signing service — **before** the `busy` lock and
before any `recoveryOnly`/custody-adjacent branching. This means a GET
`/admission` probe can run concurrently with an in-flight `/sign` or
`/reconcile` request without being blocked by, or itself blocking, the
single-flight `busy` guard that exists to serialize custody operations. On
failure it replies `503`, never leaking the underlying error. `conversionReply`
(unchanged, `server/token-conversion-http.mjs`) already sets
`cache-control: no-store` on every response, so the new endpoint inherits
that without needing its own change.

### Tests and config inventory

`tests/security/mainnet-candidate-observation.test.mjs` (new, 4 tests) builds
a synthetic but structurally faithful `ProgramData`/`Program` account pair
(matching the real Solana upgradeable-loader account encoding: 36-byte
`Program` pointer, 45-byte `ProgramData` header) and exercises: a clean
verified pass; ten individual single-field mutations (stale bank slot,
non-executable program account, altered pointer, wrong owner, missing-
authority flag, wrong authority, altered ELF byte, non-zero padding, altered
deployment slot, one connection reporting a null account) each independently
causing `blocked`; two connections individually valid but disagreeing on
deployed bytes also causing `blocked`; absent-deployment and wrong-genesis
handling; and that a corrupted local candidate ELF is rejected before any
network read happens at all. `tests/security/production-conversion-runtime.test.mjs`
adds one test exercising the new `/admission` route for all three roles end
to end over real HTTP, asserting `401` without auth, `200` with it,
`cache-control: no-store`, the expected admitted/role/mode/sourceRevision/
`freshSigningEligible` fields, and a `503` (plus a rejected direct
`inspectAdmission()` call) when the underlying connection's genesis check is
made to fail — then confirms it recovers to `200` once the fault clears, and
that custody/signature/send counters stayed at zero throughout.

I compared the `requiredTests` entries added to `config/security-tests.json`
and `config/production-integration-tests.json` against the actual `test(...)`
title strings in both files directly (not by inference) — they match
character-for-character. This matters because these inventory files appear to
gate CI/offline-suite completeness by exact test name; a mismatched name here
would silently make the gate pass without actually requiring the new test to
exist or pass.

## 3. Independent test execution

These are pure Node tests (`node:test`, `@solana/web3.js`, `tweetnacl` — no
native/Rust dependency), so I ran them directly on this Windows host with
`node --test`, no WSL or Docker needed for this scoped follow-up:

```
node --version
v26.13.1
```

First run (without the offline fixture env vars the owner supplied earlier in
this session) failed only on a missing-fixture `ENOENT` for
`production-conversion-runtime.test.mjs`'s unrelated pre-existing fixture
requirement — not a defect in this diff. Re-run with
`FUNDED_OFFLINE_USDC_SELL_CAPTURE` / `FUNDED_OFFLINE_PRODUCTION_ELF` /
`FUNDED_OFFLINE_REVIEW_ELF` set to the same three paths the owner gave earlier
(verified present on disk first):

```
✔ candidate observation discovers exact finalized ProgramData without granting release admission
✔ candidate observation rejects stale banks, altered ELF, authority, padding and RPC disagreement
✔ candidate observation distinguishes absent deployment and refuses wrong chain or unselected bytes
✔ deployment funding reports exact zero balance and refuses malformed or wrong-chain observations
✔ authenticated admission probes recheck every role without custody and reject changed chain context
✔ production launcher integrates three actual HTTP roles with lazy custody and exact-once settlement
✔ production launcher recovers unknown sends after restart without new custody or broadcast
✔ production launcher rejects unreviewed release, drift and signing approval before secret access
✔ production launcher rejects reused authentication and drains close during admission
✔ production launcher refuses missing journals and cannot reopen after close
✔ production references reject multiline, oversized and symbolic-link credentials

tests 11, pass 11, fail 0, cancelled 0, skipped 0, todo 0
```

All 11 required tests across the two scoped test files pass. This covers the
owner's separately reported 174/67 network-disabled container runs
(`tmp/mainnet-blockers-20261124/test-linux.mjs`, `integration-linux.json`,
`security-linux.json`) for these two files specifically; I did not re-run the
full 174/67-test container suite myself for this follow-up, since it spans
many files well outside the ten in scope and the owner's own evidence already
covers it. I also started `npm run check` (whole-repo syntax/size-budget
check) in the background as an extra sanity pass; it had not finished by the
time this report was written and, being repo-wide rather than scoped, is not
load-bearing for this review's conclusions.

## 4. Decision

**Approve within stated scope.** I found no concrete correctness or security
defect in the ten reviewed paths at commit `7e66010202f87e759a8084de57c3811062932a15`:

- The new observer (`scripts/mainnet-candidate-observation.mjs`,
  `scripts/verify-mainnet-candidate-online.mjs`) is read-only exactly as
  described: no signing, no transaction submission, fail-closed on any
  disagreement between its two required independent RPC readers, and it
  never echoes its dedicated RPC reference into its own output.
- `GET /admission` freshly re-verifies chain context and all three roles'
  journals on every call, after authentication, without ever touching
  custody or a signer, and without being blocked by or blocking the existing
  single-flight custody lock.
- The `run-production-conversion-service.mjs check` mode fix closes a real
  staleness gap (a captured-at-preparation-time admission snapshot) rather
  than being a no-op rename.
- The two new/extended security tests pass when I ran them myself, and the
  two inventory config additions name those tests exactly.

This decision is scoped strictly to these ten files and does not change,
widen, or re-affirm the separate scoped decision in
[`production-candidate-claude-2026-11-24.md`](./production-candidate-claude-2026-11-24.md)
on the contract candidate itself, and does not constitute Mainnet activation
or financial acceptance of anything. The program remains unaddressed/undeployed
(per the prior report's own on-chain check) and `mainnetActivationAuthorized`
remains `false` in `config/mainnet-deployment-plan.json`. The owner's stated
next priority is Devnet fixes first, with Mainnet remaining disabled; this
review does not bear on that work and did not touch it.
