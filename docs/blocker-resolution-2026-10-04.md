# Remaining-blocker pass — October 4, 2026

Six agents reviewed backend recovery, contracts, worker readiness, startup behavior, real-container acceptance and release packaging. This pass closes reproducible code and local-operation gaps. It does not establish public Devnet or mainnet readiness.

## Fixed

- App navigation no longer waits for router, X or reward-service responses during startup. Optional module failures surface a reload action without preventing unrelated panels from loading. Mobile Phantom cryptography loads on demand.
- Community/receipt workers reject missing, invalid, future and stale health evidence. Failed worker passes clear previous ready status immediately. The holder indexer verifies its separate RPC's genesis hash before each snapshot.
- Token metadata supports a trusted deployment origin in browser and server configuration. New records persist that origin; existing records and old on-chain URLs retain their original identity. Host headers and uploaded fields cannot select the metadata host. Static JSON uses the correct MIME type.
- Real Docker startup uncovered unreadable root-owned source files and an unwritable runtime data directory. The image now runs as UID 1000 with readable source and a writable data volume under a read-only root filesystem. Dependency installation supports a build-only proxy CA with strict TLS.
- The browser source digest now covers nested shared policy configuration. Native Render hosting pairs browser/API origins and source identity, forces Devnet, and refuses server signing credentials.
- Added a signer-disabled Compose profile and a free [Render + Neon setup and GitHub access guide](render-neon-devnet.md). No account or service has been provisioned remotely.

## Acceptance evidence

- [PostgreSQL recovery](recovery-drill-2026-10-04.md): real fresh PostgreSQL 16 dump/restore, all 16 public tables compared, metadata and reward sidecar verified, restored authentication invalidated, claim replay/concurrency checks and mocked reward reconciliation with zero submissions. The fixture timing is not a production recovery objective.
- [Local contract acceptance](contract-readiness-2026-10-04.md): current artifact `f2fe2b160a861c74ddcff7aa74e79874191c2dc2c9d21b6ef5b1b4529daca470` matched bytes on two fresh local validators. Community escrow/open/claim and reward prefunding, settlement, two-recipient claims, replay rejection and authority rotation passed. Local signatures are not public Devnet transactions.
- [Production-container checks](local-container-verification-2026-10-04.md): two app replicas sharing real PostgreSQL 17 passed health/status, exact candidate identity, static/deep-link behavior, challenge consumption races, signed chat, impersonation rejection and session revocation. These were actual HTTP calls without API interception. Final clean-commit image evidence is delivered separately in `funded-delivery/final-container-verification.json` when verification finishes.
- Final checks passed: 149 Node tests, 16 fixture-backed browser journeys, 430 JavaScript syntax checks, six critical checks, all 65 explicitly isolated local regression scripts, production build, isolated HTTP release and browser settings/source provenance checks. Real-container browser evidence is separate from the fixture-backed suite. The exact source revision is recorded in the delivery handoff.

## External and design gates still open

1. GitHub writes still return HTTP 403. Publish the committed branch after granting Contents, Workflows and Pull requests write access; then inspect GitHub Actions and review the PR.
2. `funded.vip` still returns HTTP 530 / Cloudflare Tunnel 1033. Restore the original host/tunnel or provision the new host. Old minted metadata URLs require the original domain to remain reachable.
3. No Render, Neon, hosting or signer credentials are bound to this environment. The free web profile sleeps and runs no financial workers. Complete automation needs durable, always-on workers, explicit Devnet authority configuration and funded operational wallets.
4. Complete the fresh public **UI-to-chain** journeys after hosting is available: launch registration, paid tiers/Boost, collection and allocation, each claim route, graduation/buyback, real OAuth and physical mobile-wallet callbacks. Existing isolated SDK transactions and browser fixtures cover narrower boundaries.
5. Configure offsite backup retention/PITR, coordinated live snapshots and deployed-sized recovery. Local recovery passed; production disaster recovery and real post-backup chain reconciliation remain unproven.
6. Mainnet requires the documented authority/initialization/reservation/rotation design decisions and independent security review. No mainnet activation, contract deployment or public upgrade occurred in this pass.

The main app chunk remains about 529 KB uncompressed. Lazy mobile crypto reduces initial work, but a broader feature extraction is still needed to remove the large-chunk warning. It is not hidden by increasing the threshold.
