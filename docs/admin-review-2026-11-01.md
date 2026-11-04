# Admin review — 1 November 2026

The admin fixes are committed as `60bf51356b718b585a0c4bc4031fb052eb3dee3f` and deployed to Devnet. The latest launch-page changes are retained in frontend `f1780bb72ae31fe08141e69bbaccc6c5cbb2690c`. This review submitted no Solana transaction and made no live admin policy or X publishing change.

## Fixed findings

- **Reward accounting:** inventory previously read the rent-funded `RewardReserve` metadata PDA as cash. It now reads the actual `RewardVault`, verifies its program owner, discriminator, mint and authority, and reads liabilities separately from the matching SOL reserve account. Missing or substituted accounts remain unverified. Finalized reads cover both legacy and agency layouts.
- **Withdrawal permissions:** an operational signer also configured under an external treasury role could appear eligible for withdrawal. All aliases of server signer addresses are now excluded from treasury withdrawals and receipt reconciliation.
- **Session recovery:** expired sessions lock and clear the workspace. Late responses cannot restore it after logout. A temporary balance RPC failure leaves a valid session usable and offers refresh. Concurrent refreshes cannot replace newer data.
- **Transfer recovery:** duplicate submissions are blocked. The reviewed wallet and exact transaction message must match before broadcast; Devnet and blockhash validity are checked. A known public signature is saved before sending and survives reload. Lost acknowledgements require reconciliation of that same signature. New transfers stay blocked until finalized exact balance evidence, finalized failure, or expired non-landing evidence is available. No private keys or signed transaction bytes are stored.
- **Configuration signing:** the authority wallet, reviewed message, session and Devnet blockhash are checked. Duplicate signing is blocked and the known signature fills the publication recovery form before broadcast.
- **Monitoring and layout:** a private gateway/Redis panel separates Redis, memory, batching and coalescing savings. It reads local gateway metrics without calling Helius. Financial monitoring rejects future-dated freshness. Long signatures wrap on mobile; X queues and prepared recovery reviews clear on logout.

## Validation

| Check | Result | Scope |
| --- | --- | --- |
| Backend regressions | 11 passed | Actual route/helper logic; deterministic chain fixtures, not new on-chain transfers |
| Browser regressions | 15 passed | Sessions, mobile layout, policy controls, duplicate signing and receipt recovery; API/RPC fixtures and a browser-only ephemeral wallet |
| Compiled public frontend | 6 passed | Session/monitoring cases repeated against the deployed bundle with intercepted API fixtures; overlaps the 15 cases |
| Signed HTTP/PostgreSQL | 9 passed | Real ephemeral wallet signature, actual HTTP routes, disposable PostgreSQL, fee review, X review, audit and concurrency; no API mocks, X dispatch or Solana transactions |
| Public smoke | Passed at 1440px and 390px | Actual deployed frontend and unauthenticated API, no wallet or API mocks; no JavaScript errors, app writes or horizontal overflow |
| Live accounting | Verified | Finalized Devnet account reads through the shared gateway, deployed helper and exact source hashes |
| Syntax/changed-file budgets | Passed for all 21 files | Repository-wide size check separately finds an existing 504-line `server/index.mjs` above its 500-line budget; this file was not changed by the admin patch |
| Frozen production build | Passed | Devnet settings; mainnet and development wallet disabled |

The live acceptance mint `ANi8jBnhX8E8t7ZYcEWxMXxZKGGzTFmZttEVyNJy9bAW` has reward vault `2wduTabgznZvGb3jDMT3GkzPLdV6eHrt6ih4sbd4xnu6` and separate reserve metadata `CN4DvCPqiQnotx1Rs69LKnwsMn6BA2gwArtm1cwDGgTV`. The verified cash balance was **1,079,003 lamports**, including **1,021,080** rent reserve and **10,201** outstanding liability, leaving **47,722** unassigned and **zero shortfall**. Unassigned SOL is not authorized for withdrawal.

## Deployment and limits

The app, collector and two buyback services run `fundedapp-devnet:admin-60bf5135-r2`, image `sha256:19ce46cf129e0406eec74510610f47b7af13a0c55591a32e9e4b4fede0dd2f6d`. This is the previously tested financial image `6645520e` plus the explicitly hashed admin files and frozen frontend; it is not a rebuild of unrelated backend changes. Existing registration patches, data and secret mounts were retained. Services keep normal Devnet settings and use `http://rpc-gateway:8899`.

The existing gateway (`bd90a8d6`) and Redis containers were not restarted. Redis is ready and the gateway verifies Devnet. Signed-out calls to session, overview, vault inventory and RPC health return HTTP 401. Source hashes in the running container match the committed admin release, and the served frontend digest is `c81c7256873df8825ae559646b064d48ede31243a8800dfc905aa4c764b63634`. The app and collector report healthy. At 10:19:42 UTC, public status reported operational storage/network and **all six recorded collections verified**. The first post-restart scan timed out; the next scan completed after cache warm-up, without changing verification budgets or RPC pacing.

The private admin write paths were exercised in isolation, not against live treasury balances. Transfer acknowledgements, expiry and transaction-message tampering were exercised with mocked Devnet RPC. No new smart contract deployment was needed. The post-restart public settlement verification result is recorded separately in the [machine-readable evidence](admin-review-2026-11-01.json). Changes are committed locally; no push was requested.
