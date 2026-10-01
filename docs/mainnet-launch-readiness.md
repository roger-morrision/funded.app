# Mainnet launch readiness

The hosted funded.vip launch remains **Devnet only**. The separate Mainnet preview is read only. A Mainnet build must not enable coin creation by changing `VITE_ALLOW_MAINNET` alone: the launch client, metadata service, registration API, and fee distribution still contain Devnet-specific paths. The client launch function and registration API reject Mainnet until these dependencies are implemented and verified.

## Current evidence — 2026-10-01

The public Devnet release contract passed through `https://funded.vip`: health, capabilities, deep links, assets, wallet-signed chat contract, and 20 parallel read requests. The [fee-funded holder payout](devnet-fee-funded-holder-payout-qa-2026-10-01.md) and [four buy-and-burn receipts](devnet-holder-payout-buyback-qa-2026-10-01.md) have finalized on-chain checks. These are Devnet results. The public `/api/readiness` response remains `ready: false` with `scope: configuration-only`.

The remaining Mainnet gates are concrete: an independently reviewed and deployed fee router; dedicated audited buyback custody rather than the Devnet executor; a verified community migration snapshot and payable cycle; Mainnet proof for X, creator, holder, referral, and fee routing with separate credentials and infrastructure; and a self-contained source release after the mixed checkout is reconciled. The pinned Devnet overlay is a reproducible patch on this host, not a Mainnet artifact.

## Required before enabling Mainnet

1. Deploy and independently review the fee-router program on Mainnet. Verify its program ID, authority, mint-specific PDA, Pump creator-fee route, and recovery path against Mainnet accounts.
2. Configure separate Mainnet RPC, database, signing roles, funded token mint, and metadata/image storage. Keep Devnet and Mainnet records and credentials isolated.
3. Replace Devnet metadata URLs and signing statements with network-specific versions. Confirm images and metadata remain available after launch.
4. Make launch simulation, cost review, transaction signing, confirmation, and mint/fee-owner verification use the selected network consistently. Never reuse a Devnet quote or blockhash on Mainnet.
5. Verify fee collection, allocation, creator/holder/X/referral/community/buyback settlement, indexing, and claim receipt reconciliation with the Mainnet router before promising rewards.
6. Run wallet and backend tests against a dedicated Mainnet canary with a capped spend. Check finalized transactions, registered mint and metadata, exact fee owner, and expected balance/state changes. Document rollback and incident handling.

Only after every gate passes should the Mainnet launch guard in `app.js`, `launch-flow.js`, and `server/index.mjs` be lifted together. Keep the Devnet launch available throughout the rollout.
