# Saved expiry recovery before fresh-work readiness

FQA-MN-005-EXPIRY-02, local source/runtime correction. The prior 9174 transport
acceptance remains valid for its covered chain path; this fixes reachability
through `createRewardScheduler.execute`. Mainnet admission and spending stay off.

Previously `execute` returned unavailable before reaching saved expiry recovery.
The unchanged independent QA probe fails on 9174: no recovery call, saved state
still prepared, while direct invocation of the same actual chain verifies it.

`execute` now resolves the selected schedule IDs and runs a saved-attempt-only
chain recovery pass before fresh readiness. Saved attempts are independent of
today's unpayable classification, caller clock and fresh grace configuration.
The existing immutable plan, program/transaction and owned-state proof checks
continue to govern attribution. Local proof/status persistence is allowed;
no new chain transaction is allowed in this pass.

The `recoveryOnly` option is propagated through the real chain into
`executeRewardExpiry`. If the attempt disappears after selection, that lower
layer returns before readiness, blockhash lookup or signing. Falsy/corrupt saved
markers cannot be reinterpreted as fresh authorization. A disappeared attempt is
retained from the frozen selected snapshot only when the original plan still
matches and no newer attempt exists, so later healthy passes also cannot replace
that uncertain transaction. Removed schedules are
not recreated, and changed immutable plans cannot inherit old completion or
error metadata. Completion still requires the same durably verified signature.

Fresh readiness remains mandatory for the normal expiry/commit/payout path.
Unavailable readiness keeps its existing unavailable response and zero reported
submissions. Throwing readiness still throws after saved recovery. The ordinary
post-readiness expiry pass skips already handled saved attempts, avoiding duplicate
proof work. Fresh authorized expiry remains functional. The recovery pass does
not invoke capture/indexer, cycle creation, payouts or receipt cleanup.

Node 24.22.3 explicit inventory:

```text
node scripts/security-tests.mjs --inventory config/reward-expiry-readiness-tests.json
```

Use the preceding three public capture/ELF inputs; optional network evidence
provider overrides stay unset. **43/43 required cases pass**, zero fail/skip/TODO:
the existing 29 affected transport/context cases and 14 scheduler boundary cases.
Coverage includes unavailable/throwing readiness, selected and empty ID filters,
landed/unknown/no-attempt state, disappearance/removal/replacement races, corrupt
markers, classification/grace independence, no duplicate recovery and authorized
fresh expiry. Missing current public ELF fails closed with zero required passes.

The original QA probe SHA-256
`472c51bfd1ea078353896709886e0dc8e03c595188595e9396d389ddb94f88c8`
is unchanged before/after: old source fails; fixed source passes with one recovery,
verified saved state, zero fresh blockhashes/broadcasts and `submitted:0` while
remaining unavailable. Bank/RPC/finality are synthetic; test signatures exist only
in memory. This is no live financial acceptance or Mainnet activation result.

No Contract source/ELF/ABI, loader prefix/quote, entitlement, cap, allowlist or
replacement policy changes. Failed/expired attempts still require explicit review
before replacement. Historical committed payouts, authenticated archive/live28,
scale, production custody and final release/funding criteria remain separate.
