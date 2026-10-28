# Mainnet launch readiness

The supported launch flow remains **Devnet only**; this does not establish that the public host is currently available. The separate Mainnet preview is read only. A Mainnet build must not enable coin creation by changing `VITE_ALLOW_MAINNET` alone: the launch client, metadata service, registration API, and fee distribution still contain Devnet-specific paths. The client launch function and registration API reject Mainnet until these dependencies are implemented and verified.

## Active beneficiary-routing release block

V3 enforces the 80/20 allocation into seven per-mint vaults, including the configured six protocol rates. Its `disburse_mint_v3` instruction does **not** commit the creator/holder/X subshares or the operations and referral beneficiaries. Two signatures and server-side entitlement checks constrain the current Devnet flow, but they are not an on-chain beneficiary policy. The V3 launch config and registration API now refuse **new** launches even if all operator switches are enabled. Existing V3 collections and obligations still require reconciliation; this gate does not reverse finalized transactions or alter their payout instructions.

Removing this block requires a versioned router that commits subshares and approved payout destinations on chain, closes every older-instruction bypass against its vaults, and has a migration or payout path for existing V3 balances. Holder and X budgets need distinct on-chain accounting through final claims; referral identities need a documented, reviewable binding rule. Prove unauthorized destination, wrong share, replay, rounding, upgrade, and migration cases in program tests; then verify the exact deployed bytecode and finalized Devnet balance changes. Independent security review and the remaining Mainnet gates below are still required. Changing the `beneficiaryRoutingOnChainEnforced` response alone does not satisfy this gate.

## Deployment verification

Historical availability checks and Devnet receipts do not establish current public access or Mainnet readiness. Match the running image and build identity to the intended committed revision, then verify public HTTPS health, assets, deep links and required Devnet routes from an external client. A deployment record or local Docker success alone does not establish public access. Follow the [release, incident and recovery runbook](operations-runbook.md) for current evidence requirements.

The remaining Mainnet gates are concrete: an independently reviewed and deployed fee router; dedicated audited buyback custody rather than the Devnet executor; a verified community migration snapshot and payable cycle; and Mainnet proof for X, creator, holder, referral, and fee routing with separate credentials and infrastructure. Canonical committed Devnet source and a transferable deployment bundle are now available; the earlier mixed-checkout reconciliation is no longer an outstanding source-delivery gate. That delivery is not an independently reviewed Mainnet release. A Mainnet artifact still requires the exact source revision, immutable application and contract digests, separate Mainnet configuration, and evidence that every gate below has passed.

## Required before enabling Mainnet

1. Deploy and independently review the fee-router program on Mainnet. Verify its program ID, authority, mint-specific PDA, Pump creator-fee route, and recovery path against Mainnet accounts.
2. Configure separate Mainnet RPC, database, signing roles, funded token mint, and metadata/image storage. Keep Devnet and Mainnet records and credentials isolated.
3. Replace Devnet metadata URLs and signing statements with network-specific versions. Confirm images and metadata remain available after launch.
4. Make launch simulation, cost review, transaction signing, confirmation, and mint/fee-owner verification use the selected network consistently. Never reuse a Devnet quote or blockhash on Mainnet.
5. Verify fee collection, allocation, creator/holder/X/referral/community/buyback settlement, indexing, and claim receipt reconciliation with the Mainnet router before promising rewards.
6. Run wallet and backend tests against a dedicated Mainnet canary with a capped spend. Check finalized transactions, registered mint and metadata, exact fee owner, and expected balance/state changes. Document rollback and incident handling.

Only after every gate passes should the Mainnet launch guard in `app.js`, `launch-flow.js`, and `server/index.mjs` be lifted together. Keep the Devnet launch available throughout the rollout.
