# Mainnet launch readiness

The supported launch flow remains **Devnet only**; this does not establish that the public host is currently available. The separate Mainnet preview is read only. A Mainnet build must not enable coin creation by changing `VITE_ALLOW_MAINNET` alone: the launch client, metadata service, registration API, and fee distribution still contain Devnet-specific paths. The client launch function and registration API reject Mainnet until these dependencies are implemented and verified.

## Historical evidence — 2026-10-01

On that date, the public Devnet release contract passed through `https://funded.vip`: health, capabilities, deep links, assets, wallet-signed chat contract, and 20 parallel read requests. The [fee-funded holder payout](devnet-fee-funded-holder-payout-qa-2026-10-01.md) and [four buy-and-burn receipts](devnet-holder-payout-buyback-qa-2026-10-01.md) have finalized on-chain checks. These are historical Devnet results. The public `/api/readiness` response then reported `ready: false` with `scope: configuration-only`.

The later read-only check recorded in the [maintenance backlog](maintenance-backlog.md#current-cycle), on 2026-10-04 at 09:54 UTC, found `https://funded.vip/api/health` returning HTTP 530 with Cloudflare error 1033. Public availability is therefore blocked pending a fresh successful external check; the October 1 receipts and local test results do not establish a working public deployment today. Before inviting participants, consult the actual deployment record outside Git at `/workspace/funded-deployment/`, match the running image and build identity to the intended committed revision, and verify public HTTPS health, assets, deep links, and required Devnet routes from an external client. See the [build and deployment evidence guidance](maintenance-backlog.md#build-and-deployment-evidence). A deployment record or local Docker success alone does not establish public access.

The remaining Mainnet gates are concrete: an independently reviewed and deployed fee router; dedicated audited buyback custody rather than the Devnet executor; a verified community migration snapshot and payable cycle; and Mainnet proof for X, creator, holder, referral, and fee routing with separate credentials and infrastructure. Canonical committed Devnet source and a transferable deployment bundle are now available; the earlier mixed-checkout reconciliation is no longer an outstanding source-delivery gate. That delivery is not an independently reviewed Mainnet release. A Mainnet artifact still requires the exact source revision, immutable application and contract digests, separate Mainnet configuration, and evidence that every gate below has passed.

## Required before enabling Mainnet

1. Deploy and independently review the fee-router program on Mainnet. Verify its program ID, authority, mint-specific PDA, Pump creator-fee route, and recovery path against Mainnet accounts.
2. Configure separate Mainnet RPC, database, signing roles, funded token mint, and metadata/image storage. Keep Devnet and Mainnet records and credentials isolated.
3. Replace Devnet metadata URLs and signing statements with network-specific versions. Confirm images and metadata remain available after launch.
4. Make launch simulation, cost review, transaction signing, confirmation, and mint/fee-owner verification use the selected network consistently. Never reuse a Devnet quote or blockhash on Mainnet.
5. Verify fee collection, allocation, creator/holder/X/referral/community/buyback settlement, indexing, and claim receipt reconciliation with the Mainnet router before promising rewards.
6. Run wallet and backend tests against a dedicated Mainnet canary with a capped spend. Check finalized transactions, registered mint and metadata, exact fee owner, and expected balance/state changes. Document rollback and incident handling.

Only after every gate passes should the Mainnet launch guard in `app.js`, `launch-flow.js`, and `server/index.mjs` be lifted together. Keep the Devnet launch available throughout the rollout.
