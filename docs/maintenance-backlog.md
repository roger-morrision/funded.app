# Maintenance backlog

Prioritize verified failures and acceptance gaps. Close a row only with evidence of the stated result; unavailable accounts, devices, faucets or services remain dependencies. Each hourly cycle selects a bounded subset rather than promising to finish every item.

The approved creator-community pilot targets research with **100 real, consenting participants**. This is a recruitment and learning target, not a statement of current users, activation or retention. Start with a small observed cohort, fix demonstrated blockers, then expand toward 100. Do not add unrelated features to fill an hourly cycle.

| Priority | Work | Acceptance evidence |
| --- | --- | --- |
| 1 | Make a stable public Devnet preview usable by pilot participants | Verified HTTPS origin, exact image/build identity, matching browser/server metadata origin, healthy database/RPC and deep links; an external participant can open it without workspace credentials. Local loopback success does not establish public access |
| 1 | Run the approved research pilot toward 100 real participants | Record invited, consented, started and completed counts separately; recruit with explicit channel authorization, observe a small initial cohort, record concrete task failures and changes, and expand only after resolving blocking findings. Exclude agents, synthetic fixtures and repeat device sessions from participant counts |
| 1 | Define opt-in activation and cohort measurement before reporting results | Versioned task/event definitions, consent, fixture exclusion, minimal data collection and clear denominators; report consented sample size and missing coverage. Count activation only when the defined task completes, and compare returning cohorts over a stated time window. Device-local telemetry alone cannot establish unique people or cross-device retention |
| 1 | Remove participant-observed onboarding, accessibility and mobile wallet blockers | Keyboard/focus and real-device observations, exact failed step and reproducible repair, wallet cancellation/recovery evidence; desktop emulation is partial coverage. Make Devnet/test funds and unavailable capabilities clear before wallet actions |
| 1 | Complete fresh financial Devnet journeys when isolated funding and required role configuration are available | Finalized launch/registration, trades, collection/allocation, eligible claims and burn receipts with exact recipient/balance/supply deltas; replay and uncertain-submission recovery. Never represent synthetic or unfunded flows as completed financial journeys |
| 1 | Preserve contract safety, data recovery and custody boundaries | Canonical bytecode/source identity, transaction regressions, isolated database/metadata/ledger restore, measured recovery time, no duplicate payment authorization and documented authority/recipient/funding limitations; independent review before mainnet claims |
| 2 | Protect hourly maintenance from overlap and stale deployment claims | Real concurrent-process lease tests, bounded task selection, actual agent/tool availability, commands and pass/fail/blocked outcomes; exact committed source, freshly built browser digest and running image identity must agree |
| 2 | Reduce measured first-task loading delays | Before/after transferred bytes and route-ready observations on the same device/network; preserve wallet/quote behavior. Prioritize delays observed in the pilot, retain visible bundle warnings and avoid cosmetic file splitting merely to silence them |
| 2 | Keep X event preparation safe while publication remains disabled | Account/network gates, start watermark, bounded processing, equal-timestamp boundary reconciliation, exact integer reward amounts, deduplication/uncertain-delivery handling and drafts from verified evidence; account authorization, public Devnet posting policy and actual publication are separate gates |
| 2 | Preserve privacy-control feedback on every supported build | Failed local-data deletion must remain visible beside network restrictions; verify retained storage, disabled recording/export after failure, and clear recovery guidance in a real browser |

## Build and deployment evidence

The source checkout, ignored `dist/` directory and running Docker image can represent three different revisions. A clean commit alone does not prove the browser was rebuilt after the last UI change. Generate the release manifest only after the final build; its browser-source digest must match the checkout. Do not use `--allow-dirty` output as a release artifact. Build deployment images from the exact committed archive, not a mutable shared worktree, and compare the live API build identity with that revision.

Browser settings currently attest the network, public test-wallet gate and source digest. They do not attest every origin-related environment variable; check the actual API and metadata origins separately when moving from localhost to public hosting. Rebuild after changing the metadata origin. Verify deep routes, static assets and unmocked browser startup against the running image, rather than reusing a previous image's report.

The earlier verified `8289dc1` image had a 526.61 kB minified application chunk (154.63 kB gzip in build output); this is a build-size observation, not measured participant transfer or loading time. Investigate actual first-task delays before selecting additional code-splitting work.

The pilot pass found avoidable analysis work in the browser input path. One synthetic Node 24.19.0 diagnostic with 100 device records at the 2,000-event cap took about 10.2 seconds; analyzing one full record averaged 92 ms over ten runs. These are offline fixture timings under the current workspace load, not browser or production capacity measurements. The live panel now displays only its local event count; detailed cohort aggregation runs in the bounded offline CLI. Measure real first-task latency before making further performance claims.

## Current cycle

The creator-community pilot is approved. This cycle prioritizes public access, real participant research and consented cohort definitions; it does not claim that 100 people have joined or that retention has been measured. Hourly automation makes future work attempts, not guaranteed completion. No X worker, signing key or mainnet activation is enabled by this plan.

A read-only check on 2026-10-04 at 09:54 UTC found `https://funded.vip/api/health` returning HTTP 530 with Cloudflare error 1033. GitHub repository metadata was reachable with HTTP 200; that read-only result does not establish push permission. A subsequent read-only Codespaces check returned zero existing Codespaces; listing available repository machines returned HTTP 403, “Resource not accessible by integration.” Repository write access does not establish Codespaces provisioning permission. Public hosting remains a pilot blocker until checked again and verified healthy.

The running preview's actual image and health remain recorded outside Git under `/workspace/funded-deployment/`. Repository changes made in later cycles are not automatically running there. Read that deployment record and verify the endpoints before reporting deployment status.

The overlap guard passed six real-process tests: simultaneous acquisition, live-owner expiry, dead-owner grace/recovery, PID reuse and malformed state, TTL/owner bounds, and private persistent-holder cleanup. Combined Compose syntax validated without starting the worker. Actual PostgreSQL tests cover concurrency, restart, cursor transactions and backup/restore; X responses and financial receipts in the new tests are synthetic. Deployment updates must have their own exact-image evidence in the deployment record.

## Reproducible pilot layout regression

The desktop Home-to-pilot transition animated the sidebar width and content offset independently. A 1440 px Chromium frame probe found 13 sampled frames with the route caption behind the sidebar before a final 32 px clearance. The scoped pilot CSS fix removes those desktop geometry transitions; the same probe then observed zero obscured frames and 32 px clearance throughout. This is a layout regression measurement, not evidence of retention or conversion gains. Keep browser coverage for desktop route transitions, mobile controls and keyboard focus.

## Remaining event-history and amount gaps

The X collector now reconciles IDs at its current timestamp boundary, but older backdated insertions still need a reviewed indexed backfill. A 500-ID boundary or 200 pending verification limit must produce an explicit diagnostic without dropping the remaining sources; preserve cursor/outbox data during investigation. Shared receipt-history code outside the X collector still contains floating-point `amountSol` conversion. A future bounded fix should reuse exact decimal handling with recipient/delta regression coverage before claiming consistent sub-SOL handling across all receipt views.
