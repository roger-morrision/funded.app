# FQA-MN-001: bounded holder distribution model

Status: experimental offline slice for review, not enabled in the application.
Base: `1d3bbf40447f71430d20ccdfd49ad8503c8b8f89` on the protected readiness branch.
The existing `maxEligibleHolders = 1000` gate, financial policies and signer remain unchanged.

QA corrections to the first prototype are recorded in
[the correction evidence](evidence/holder-paging-corrections-2026-11-22.json).
Temporal weights are canonical positive integers and may exceed u64; pools and
payments retain their u64 bounds. Duplicate reconciliation compares validated
receipt facts independently of property order and preserves the original record.
This correction remains subject to independent QA re-verification.

## Scope and invariants

The planner supports at most **1,001 eligible recipients**, with pages of at most
**32 payable leaves**. It sorts canonical public-key bytes, uses the existing global
floor allocation and retained-dust policy, then commits the existing reward-leaf
format and one global Merkle root. Pagination never recomputes a local denominator
or rounds a share of the pool per page. A page is a scheduling unit, not a promised
32-recipient Solana transaction. SOL and paired mints use their integer base units.
Zero allocations remain explicit in the eligible/zero/payable counts.

The plan digest binds the cycle, asset, root, pool, expiry, counts, pages and proofs.
Persisted plans are rebuilt and checked before progress is used. An existing cycle
cannot acquire a different plan. Canonical ordering differs from legacy locale
sorting: never replace an existing cycle's manifest or reuse its commitment.

`holder-page-progress.mjs` stores the plan and progress through the existing locked,
file-synced, atomic-replacement reward store. Use a dedicated experimental ledger,
not a running application ledger. The complete state is bounded by the admitted
cohort; this deliberately does **not** claim a streaming or million-holder store.
This first slice still rewrites the bounded ledger on each state transition.

## Recovery protocol

1. Initialize the immutable plan before any scheduling decision.
2. Persist a unique page attempt **before** a future sender could submit anything.
   Pause must be explicitly false, solvency explicitly true and time before expiry.
3. A pending attempt has no automatic lease expiration or retry. Process restart,
   timeout, partial success and lost responses cannot unlock a second attempt.
4. Reconciliation checks exact cycle, asset, root, digest, recipient, index, amount,
   execution time, signature and finalized/balance-evidence flags. Partial evidence
   records only those leaves; the rest remain pending. Matching duplicate evidence
   has no additional effect; stale attempts or conflicting receipts fail closed.
5. Late delivery of evidence for execution before expiry can complete a pending
   page. Reconciliation does not authorize a new post-expiry or paused submission.
   Total paid plus outstanding plus retained dust remains exactly the pool.

The journal **does not authenticate chain evidence**. Tests supply mocked verified
records. Before any integration, an exact-program verifier must derive them from
finalized chain state and balance deltas; flags supplied by a caller are not proof.
The application does not import either new module. There is no route, RPC client,
signer, sender, deployment, cap increase or production ledger migration in this slice.

## Declared experiment budgets

`scripts/measure-holder-page-plan.mjs` measures isolated 1,000 and 1,001 cohorts for
SOL and a paired asset, under these predeclared feasibility limits:

| Metric | Limit |
| --- | --- |
| Plan generation | 1 second |
| Full offline journal progression | 30 seconds |
| Process peak RSS | 256 MiB |
| Final bounded ledger | 8 MiB |
| RPC calls, database queries, chain transactions | 0 |

It records actual file transactions and serialized bytes read/written, elapsed time,
peak RSS and final ledger size. These are local development baselines, not production
service targets. Current transport arithmetic implies at least 251 Devnet submissions
at four recipients each or 1,001 Mainnet single-recipient submissions for this cohort,
before setup, size splitting, retries or reconciliation. Those are projections, not
measured transactions. Million-holder throughput and cost remain unverified.

The [measured evidence](evidence/holder-paging-offline-2026-11-22.json) records Node
24.22.3 results, exact implementation hashes, source/build checks and all four
cohort/asset baselines. Retained raw logs live in
`data/qa-evidence/holder-paging-20261122` in the shared application checkout.

## Review and next integration dependencies

- QA/PM must review this bounded model and its evidence before changing admission.
- Contract owner: confirm exact configurable-program ABI, cycle identity/network
  binding, global index/proof bounds, bitmap capacity and authoritative replay
  lookup for SOL and paired mints. No ABI change is proposed by this offline slice.
- Bind plans to cluster genesis, program/ProgramData and approved source/ELF hashes
  before any live use. Preserve existing eligibility, snapshot completeness,
  exclusions, minimum funding, expiry, pause, solvency and signing checks.
- Implement the exact-program evidence adapter and reconcile unknown submissions
  before allowing any retry. This model intentionally has no reset/absence escape.
- Verify crash points around sender submission, finalized receipts, durable progress
  and separate worker processes with compiled-SBF fixtures. The current tests prove
  offline accounting and persistence, not chain execution or independent acceptance.
- Use bounded per-cycle/page storage with measured database and RPC budgets for
  larger cohorts. Do not extrapolate this full-file implementation to a million.

FQA-MN-001 stays open. Neither public deployment nor Mainnet activation is warranted
by this model; FQA-MN-002 through FQA-MN-006 retain their own owners and dependencies.
