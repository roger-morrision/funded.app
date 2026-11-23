# Branch integration and cleanup — 23 November 2026

Integrated the 13 historical development branches based on the deployed
`f9adab47` source, including Mainnet readiness, contract regressions, holder
paging, conversion recovery/restore, offline release planning and review settings.
The separately published `5eb2cd4f` restore commit was also merged; it did not
change the combined source tree.

Conflict resolution retained the newer controller rollback test, batched payout
recovery errors and anchor provisioning requirements. The unchanged-ledger hint
now applies to the whole locked error batch only when no saved marker or error
changes. Bootstrap, schema migration, changed state and directory durability
continue through the existing persistence checks. The older capacity reports
remain historical evidence, not benchmarks of this combined implementation.

The merge adds contract test coverage; it does not change contract program source
relative to `f9adab47`. Holder-page planning remains an offline prototype. No
network activation, deployment, signer provisioning or financial transaction is
part of this integration.

## Validation

- Node 24.22.2, network-isolated Linux container: **539 tests passed**, zero
  failures, skips or TODOs across root, security and readiness suites. Required
  public fixture bytes were mounted read-only and hash-checked by the tests.
- Syntax checks passed for 1,224 JavaScript files; source size checks passed for
  1,488 maintained files. The Devnet browser build passed on the pinned Node 24
  container base.
- Rust 1.97.1, offline local VM checks against hash-verified retained artifacts:
  **35 distinct tests passed**, including the merged 28-recipient configured
  Devnet test, maximum bitmap leaf, operator handoff and fresh-loader rehearsal.
  Six opt-in external-market CPI fixture tests were not executed. These results
  are local VM evidence, not deployed-program or financial acceptance.
- The initial Windows bind-mount run exceeded startup deadlines. The final Node
  run used container-local source and an isolated writable data volume. An
  incomplete Rust fixture package was corrected before rerunning its one failed
  daily-bonus case; a new recovery-test expectation was corrected to exercise a
  repeated error batch for the same schedule.

The Git recovery bundle and raw logs are retained locally under
`tmp/merge-cleanup-20261123`. Cleanup checks require clean worktrees and ancestry
on main before deletion. Ignored local artifacts are preserved separately;
active worktrees and the retained contract fixture checkout are not removed.
