# Bounded holder payout selection

FQA-MN-001 source candidate. Each `payRewardSchedule` call for a holder schedule
selects at most 32 unpaid leaves. The existing admission cap remains 1,000. The
1,001-leaf fixture is an injected immutable test plan, not an approved/admitted
live cohort or a new financial policy. This branch has not been deployed.

The full original manifest, root, u32 global indexes, proofs, allocation amounts
and dust remain unchanged. A locked-store cursor rotates across that manifest,
validated against its immutable identity and all original leaf proofs. Corrupt or
changed state is refused. Selection copies only the bounded leaf group into the
existing payout path. The cursor records scheduling progress; it is never a
payment, receipt, reservation or finalized accounting fact.

The cursor advances atomically before work. A crash can defer those leaves until
the next circular round, without deleting entitlements or authorizing replacements.
With 1,001 leaves a complete round takes 32 successful selection calls; actual
completion additionally depends on readiness, proofs, available funds, worker
cadence and the unchanged expiry. An unresolved attempt in an early page cannot
starve later pages. Its original saved signed attempt remains under the existing
single-payout journal and exact finalized-proof rules. No timeout resets it.

The scheduler keeps a partially completed schedule distributing and marks it paid
only when its original payment records are all paid. Existing selected-ID and
false/throwing readiness gates remain ahead of fresh work. Mainnet continues to
use one recipient per transaction; Devnet's four-recipient batch/wire/compute
bounds remain intact inside a page. Non-holder reward paths are unchanged.

This is a **per-schedule fresh-work bound**, not a whole-worker execution limit.
Schedule enumeration, saved-attempt recovery, full-manifest verification and
whole-ledger serialization still scale with existing state. Durable cursor races
use the existing locked/fsynced store; cursor selection does not replace the
per-leaf journal's final signing/broadcast ownership checks. Production cohort
limits, throughput, storage and backup capacity still require measured acceptance.

Node 24 inventory:

```text
node scripts/security-tests.mjs --inventory config/holder-payout-page-tests.json
```

79/79 pass, zero failure/skip/TODO: nine page-selection/scheduler cases and the
70 affected existing payout cases with the same reviewed public ELF inputs.
SOL and paired fixtures each visit 1,001 original leaves exactly once across 32
bounded calls, reopen the actual store between calls, retain the same full root
and total and submit no further work after completion. Tests also cover unknown
attempt preservation, crash deferral, competing selectors, global-index/proof
integrity, corrupt cursor/intent, selected IDs, readiness and batch geometry.
The same controlled 65-leaf body fails against the previous unpaged payment
function: 65 interface calls in its first pass versus the required maximum 32.

The page fixtures use synthetic attributed `submitLeaf` results and a mock chain;
they do not independently authenticate 1,001 chain receipts or transfers. The
separate 70 existing cases exercise actual signed-attempt/proof plumbing with
synthetic bank/RPC facts. No network transaction, signing service, spending,
Mainnet admission, cap increase or live scale acceptance occurred.

Independent exact-source review is requested. Full 5,063-owner census eligibility,
large-cohort capture, bounded whole-worker/recovery behavior, realistic finalized
financial throughput and the remaining release/custody gates stay open. Contract
971399ff / 3f8a and its reviewed Loader prefix remain unchanged.
