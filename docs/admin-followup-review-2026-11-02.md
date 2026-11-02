# Admin follow-up review - 2 November 2026

The admin fixes are deployed to Devnet from `6aa743db5e8efda194e93f69ad2528b16a163d4c`. The app, collector and both buyback workers run `fundedapp-devnet:admin-6aa743db5e8e`. The existing community-page updates and singular creator labels are included.

## Fixed findings

- **ADMIN-01:** Clear private issue descriptions, notes and review controls across sign-out and expired sessions; discard stale reads and writes.
- **ADMIN-02:** Require the reviewed issue version on both operator endpoints, reject conflicting writes with HTTP 409, and validate malformed input. Freeze reviewed fields during save; require a reload after an uncertain or conflicting save.
- **ADMIN-03:** Prevent duplicate configuration-publication submissions; capture and lock the exact proof and audit reason during publication.
- **ADMIN-04:** Discard pending daily-bonus reconciliation results after the selected day or reviewed hash changes.
- **ADMIN-05:** Recover service-fee and legacy-policy editing in a new session while an old save is unresolved; old callbacks cannot reset the new form.
- **ADMIN-06:** Clear authority rules and audit reasons on logout; lock signing controls while signing and after failed settings verification. Check the original session again after asynchronous finalization and before publication.
- **ADMIN-07:** Replace stale audit history with an explicit unavailable state and refresh action when reads fail.

## Verification

| Check | Result | Evidence scope |
| --- | --- | --- |
| Backend | 43 passed | Actual routes and helpers; deterministic chain fixtures. Includes real wallet-signed HTTP authentication, origin, malformed-input and conflict checks against an in-memory store. |
| Source browser | 33 passed, then 13 passed after the final authority-form guard | Actual UI, mocked API/RPC; overlapping coverage, including native signing/recovery tests and concurrent community changes. |
| Final compiled frontend | 24 passed | Frozen final release, mocked authenticated APIs; sessions, policies, issue reviews, bonus recovery and four community layouts. |
| Signed HTTP/PostgreSQL | 9 checks passed | Disposable database and ephemeral administrator; actual fee/X review components, concurrency and persistence, no API mocks. |
| Published admin page | 4 widths passed | 320, 390, 768 and 1440px. Actual public page, no interception or wallet. Native menu/Escape, wallet-unavailable feedback, hidden private workspace, no overflow or JavaScript errors. |
| Source budgets and syntax | Passed | 1,626 maintained code files; 11 changed/new code files checked for syntax. |

The eight initial browser regressions and two initial backend regressions failed before fixes. Two later browser assertion errors were corrected to check the actual disabled controls and stable row identity; the final runs above pass. Counts overlap and should not be added as unique flows.

## Deployed evidence

The running image is `sha256:6b988028c9895efc745f04dc41d4850bdecc31bca3cd060ff70bea519cadf76e`. The served frontend digest is `0305a4251363a982f30b111bd4ce7062a16cbe2f95e66fb379f2daca59048804`. Published admin HTML and its nine linked assets match the frozen build byte for byte. All six checked private admin endpoints return **HTTP 401** without a session. The app and collector report healthy, and both buyback workers retain their exact commands and normal Devnet settings. All four services use `http://rpc-gateway:8899`.

The shared gateway verifies Devnet and Redis is ready. Docker was stopped when this follow-up began; the existing app, workers, database, Redis, gateway and tunnel were restored. Database, Redis, gateway and tunnel container IDs and start times did not change during the subsequent release. Environment values other than the build ID, canonical mount targets, secret mounts and worker commands match the complete original Compose configuration, including all profiles. The original four backend hotfix hashes are preserved. Nine launch records remain, including both prior verified campaign/UI mints. Live X publishing remains paused.

The release adds the reviewed admin/server files and the previously tested public-key preference validator to financial image `604ae992`; it retains the mounted marketing configuration. It is not a rebuild of unrelated backend code. No new smart contract deployment was required.

## Limits and delivery

Live treasury mutations were not exercised. Financial signing, expiry, tampering and lost-acknowledgement tests used mocked RPC. Real signed HTTP/PostgreSQL mutations ran only against a disposable database. The audit runners submitted no Solana transaction or X post; normal restored workers continue their existing policies. Cloudflare sent four passive telemetry beacons during the public smoke; application writes were zero.

This follow-up covers admin. The earlier 929-case all-pages run was interrupted at 215 completions and is not claimed as passing. Fixes are committed locally; no push was requested. Detailed build, source hashes, service identities, test scopes and raw evidence locations are in [the machine-readable report](admin-followup-review-2026-11-02.json).
