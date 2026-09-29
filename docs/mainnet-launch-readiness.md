# Mainnet launch readiness

The hosted funded.vip launch remains **Devnet only**. The separate Mainnet preview is read only. A Mainnet build must not enable coin creation by changing `VITE_ALLOW_MAINNET` alone: the launch client, metadata service, registration API, and fee distribution still contain Devnet-specific paths. The client launch function and registration API reject Mainnet until these dependencies are implemented and verified.

## Required before enabling Mainnet

1. Deploy and independently review the fee-router program on Mainnet. Verify its program ID, authority, mint-specific PDA, Pump creator-fee route, and recovery path against Mainnet accounts.
2. Configure separate Mainnet RPC, database, signing roles, funded token mint, and metadata/image storage. Keep Devnet and Mainnet records and credentials isolated.
3. Replace Devnet metadata URLs and signing statements with network-specific versions. Confirm images and metadata remain available after launch.
4. Make launch simulation, cost review, transaction signing, confirmation, and mint/fee-owner verification use the selected network consistently. Never reuse a Devnet quote or blockhash on Mainnet.
5. Verify fee collection, allocation, creator/holder/X/referral/community/buyback settlement, indexing, and claim receipt reconciliation with the Mainnet router before promising rewards.
6. Run wallet and backend tests against a dedicated Mainnet canary with a capped spend. Check finalized transactions, registered mint and metadata, exact fee owner, and expected balance/state changes. Document rollback and incident handling.

Only after every gate passes should the Mainnet launch guard in `app.js`, `launch-flow.js`, and `server/index.mjs` be lifted together. Keep the Devnet launch available throughout the rollout.
