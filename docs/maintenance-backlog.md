# Maintenance backlog

Prioritize verified failures and acceptance gaps. Close a row only with evidence of the stated result; unavailable accounts, devices, faucets or services remain dependencies. Each hourly cycle selects a bounded subset rather than promising to finish every item.

| Priority | Work | Acceptance evidence |
| --- | --- | --- |
| 1 | Make the existing Devnet workspace reachable through the intended user-facing preview or hosting origin | Correct image/build identity, HTTPS origin, matching browser/server metadata origin, healthy database/RPC, working deep links; distinguish workspace access from public funded.vip hosting |
| 1 | Complete fresh financial Devnet journeys when isolated funding and required role configuration are available | Finalized launch/registration, trades, collection/allocation, eligible claims and burn receipts with exact recipient/balance/supply deltas; replay and uncertain-submission recovery |
| 1 | Preserve contract safety and custody boundaries | Canonical source and bytecode identity, local transaction regressions, documented authority/recipient/funding limitations; independent review before mainnet claims |
| 1 | Exercise restore and reconciliation on the current deployment version | Isolated database/metadata/ledger restore, source/image version, measured recovery time and no duplicate payment authorization |
| 2 | Protect hourly maintenance from overlap and misleading completion claims | Real concurrent-process lease tests, bounded task selection, actual agent/tool availability, commands and pass/fail/blocked outcomes, clean handoff |
| 2 | Validate X event preparation and deduplication without posting | Account/network gates, start watermark, one-item pass, deduplication/uncertain-delivery handling, drafts from verified evidence; actual posting remains separately gated |
| 2 | Reduce initial application loading cost without changing financial behavior | Before/after transferred bytes and route-ready observations, preserved wallet/quote behavior and browser regressions; retain visible bundle warnings until addressed |
| 2 | Improve accessibility and real mobile wallet completion | Keyboard, focus, screen-reader/zoom findings and device-wallet handoff/cancellation/recovery evidence; desktop emulation alone is partial coverage |
| 3 | Improve opt-in activation/cohort measurement | Documented event definitions and denominators, fixture exclusion, consent and data minimization, observed completion/retention rates with coverage limits |

## Current cycle

The maintenance automation is configured, but future execution is not yet evidence. This cycle adds the local overlap guard, durable X outbox and collector, exact receipt formatting, explicit trade-sharing consent, and a disabled worker Compose profile. The browser adds a compact first-steps guide, links to saved work and undo for saved-search deletion. No X worker, signing key or mainnet activation is enabled by these changes.

The running preview's actual image and health remain recorded outside Git under `/workspace/funded-deployment/`. Repository changes made in later cycles are not automatically running there. Read that deployment record and verify the endpoints before reporting deployment status.

The overlap guard passed six real-process tests: simultaneous acquisition, live-owner expiry, dead-owner grace/recovery, PID reuse and malformed state, TTL/owner bounds, and private persistent-holder cleanup. Combined Compose syntax validated without starting the worker. Actual PostgreSQL tests cover concurrency, restart, cursor transactions and backup/restore; X responses and financial receipts in the new tests are synthetic. Deployment updates must have their own exact-image evidence in the deployment record.
