# Hourly engineering maintenance

An hourly engineering automation has been configured. Scheduling makes another work attempt; it does not guarantee that an execution environment, repository access, six agent slots, a particular model, browser tools, RPC quota or account credentials will be available at that time. Each run must report what actually happened. CI results are useful evidence but must not be described as locally executed end-to-end or on-chain tests.

The hourly engineering automation is separate from the optional X event worker. It must not post to X, Slack, email or another account as a substitute for the worker. X posting remains disabled until the appropriate account authorization, configuration and explicit execution gates are satisfied.

## One run per shared workspace

Before editing, check `node scripts/maintenance-run-lock.mjs status`. The default state is outside Git at `/workspace/funded-maintenance/lease.json`. On Linux, the helper uses `flock` to serialize acquisition, renewal, release and stale-state inspection. Install the `util-linux` package if `flock` is unavailable; report the blocker rather than running unlocked. This is a cooperative local-workspace guard, not a distributed lock between independent hosts.

For a tool-driven agent run, start a persistent holder process with a unique private token file:

```sh
node scripts/maintenance-run-lock.mjs hold \
  --path /workspace/funded-maintenance/lease.json \
  --ttl-seconds 3000 \
  --token-file /tmp/funded-maintenance-THIS-RUN.token
```

Keep the holder process/session alive while any of the run's agents can edit. The helper creates the token file exclusively with mode `0600`; replace `THIS-RUN` with a unique identifier. A busy acquisition exits with code 2 and does not create a new token. In that case, report the existing run and stop this cycle without editing or disturbing its agents. Do not read a previous run's token file to take over its work.

If the automation already has a stable Linux supervisor PID that lives for the whole cycle, `acquire --owner-pid PID` is an alternative to `hold`. Do not use an ephemeral one-shot shell or acquire-command PID as the owner. The helper records the process start tick, boot identity and hostname to distinguish PID reuse and restarts.

Check ownership before a new mutation phase and after a long tool wait. Renew explicitly if needed:

```sh
node scripts/maintenance-run-lock.mjs status
node scripts/maintenance-run-lock.mjs renew --token-file /tmp/funded-maintenance-THIS-RUN.token --ttl-seconds 3000
```

The default TTL is 50 minutes; accepted TTLs range from one second to two hours. Expiration alone never permits replacing a live owner. An `expired-live` run blocks its successor and requires its owner to finish or renew. A dead owner remains blocked until its TTL expires, then acquisition may reclaim it. Unknown-host or malformed state is blocked for review. The helper sends no termination signals to other processes. If a holder was orphaned after an automation failure, inspect it and confirm that all associated editing has stopped before an operator releases its token; do not kill processes to make the next hourly slot run.

After every child agent has finished and all source mutations have stopped, release in the run's cleanup path:

```sh
node scripts/maintenance-run-lock.mjs release --token-file /tmp/funded-maintenance-THIS-RUN.token
```

The holder notices release and exits. Remove that run's token file afterward. Release requires the matching random ownership token; a prior run cannot release a successor. Do not delete the `.flock` gate file: replacing its inode can create independent concurrent locks. A failed ownership check means stop new edits and report the blockage.

## Bounded cycle

1. Acquire the workspace guard. Inspect Git status, the previous report, open blockers, CI and the actual running deployment before selecting work. Preserve uncommitted user changes. The existing Docker preview must stay up unless an explicitly selected deployment step requires its restart.
2. Delegate the six available engineering roles when supported: backend/data; frontend/user journeys; contract/security; Devnet/operational verification; browser/accessibility QA; and release/performance. Assign disjoint file ownership. If the environment offers fewer agents or tools, report the reduced coverage and perform a smaller sequential cycle.
3. Select a small number of measurable improvements from the backlog. Prefer a reproducible failure, security issue, broken user journey or failed acceptance gate. Do not rename, restyle, split files or add features merely to produce an hourly diff. A no-change verification run is a valid outcome.
4. Keep each cycle within roughly 45 minutes of active work. Reserve the remaining time for integration, relevant checks, a reviewable commit and a truthful report. If work needs longer, keep ownership, renew it and let the next scheduled attempt skip; do not start overlapping cycles to meet the clock.
5. Run checks appropriate to the changes, then the repository's required integration gates. For financial changes, distinguish model tests, local validator bytecode tests, live Devnet transactions and verified production evidence. Record finalized signatures and exact deltas when on-chain work is authorized and configured. Faucet or credential failure is a blocker, not a pass.
6. Review and commit authorized source changes when Git access permits. A local commit, exported patch, CI pass and pushed branch are separate outcomes. Report failed GitHub access accurately and preserve a clean transferable patch; never claim a push succeeded from a local commit alone.
7. Record completed work, actual commands/results, skipped coverage, source/image identities, unresolved dependencies and the next ranked improvement. Release the guard after agents finish. Do not redeploy, enable financial workers, change custody, publish social posts or claim mainnet readiness merely because a cycle passed.

## State and evidence to inspect

Use `/workspace/funded-deployment/deployment.json` and the control scripts beside it for the persistent Docker preview. That deployment has its own source snapshot, pinned image, PostgreSQL volume and private credential files. Never infer its version from the current Git checkout, or copy those credential values into a report.

Store cycle reports outside Git, for example `/workspace/funded-maintenance/runs/<UTC timestamp>.json`, with source revision, selected tasks, agent/tool availability, check outcomes, deployment observation and blockers. Keep sensitive inputs out of reports. Add repository documentation only when it is durable guidance or a meaningful acceptance record; avoid endless timestamp-only commits.

Measure opt-in launch completion, wallet cancellation, first trade, claim completion, time to payout and returning cohorts when the underlying events and denominators are available. Distinguish observed users from fixtures and device-local opt-in telemetry from a full product analytics system. An hourly automation cannot substantiate claims about millions of users or predict growth without measured evidence.

## Optional X worker deployment

`compose.x-post-worker.yml` defines an `x-posting` profile using the same verified application image and database. It is absent from the normal stack. The command is draft-only (`--loop` without `--execute`), enabled flags default false, processing is capped at one item per pass, six posts per hour and 24 per day, and the polling interval is fixed at 60 seconds. The shared reward ledger is mounted read-only; delivery state lives in PostgreSQL. No Solana signer or server-held test wallet is mounted.

A future authorized posting deployment needs a dedicated user posting token mounted only on that worker, the expected account handle/ID, an HTTPS public origin and an explicit `X_POST_START_AT` watermark. Browser X login/read-only identity credentials do not establish posting permission. `X_POST_ENABLED=true` and a reviewed command override adding `--execute` are both required. Devnet posting additionally requires the explicit `X_POST_ALLOW_DEVNET` gate. Keep all these gates off until the account and network-specific posting policy are approved.

In this managed environment, an outbound HTTPS worker also needs the current read-only proxy CA mount and `NODE_EXTRA_CA_CERTS`/`NODE_USE_ENV_PROXY` settings, as the application runtime override already provides. Do not bake the session CA or token into an image. A sleeping free web service cannot guarantee continuous event processing; use an always-on worker host with shared durable PostgreSQL when delivery matters. No X worker was started by this maintenance setup.

See [X event worker setup](x-event-worker.md) for exact account, credential, draft inspection and token rotation requirements.
