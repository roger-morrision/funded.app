# Devnet admin workspace

Open `/admin` on the deployed funded.vip Devnet preview. The page is inert until a
configured administrator signs the one-use sign-in message. The admin key is a
separate Devnet QA wallet; the browser never receives an API token or a server
signer secret.

Set `FUNDED_ADMIN_WALLETS` to a comma-separated list of administrator public
addresses. Set `FUNDED_ADMIN_WITHDRAW_DESTINATIONS` to approved Devnet receiving
addresses. Both default to empty in a fresh deployment. Never use QA keys in a
Mainnet configuration. The local ignored `.env.deploy` can carry public
addresses; `.secrets/devnet-admin-qa-keypair.json` is a local ignored test key.
`node scripts/provision-admin-qa-wallet.mjs` provisions that key once without
printing its secret.

The fee editor changes only the protocol's fixed 20% share. Six rates must
total 100% of that share and fit V3 integer on-chain units. A successful save
creates a versioned persisted policy for **future launches**. The browser
fetches that policy at startup; a page already open before a change should be
reloaded. Existing launches retain their signed policy and on-chain category
units. Collection, settlement, reward funding, X payouts, buyback, and status
proofs therefore read the saved mint split, not the current admin default.

The wallet table shows configured ordinary wallet roles with finalized Devnet
SOL balances. Revenue cards show recorded verified V3 gross collections and
operations allocations, not cash profit. Vault pages enumerate every recorded
V3 mint's seven category vaults and holder/X reward vault in pages of ten
mints. The balances include rent and obligations; a vault has no ordinary
private key and can only pay through its program's allowed instructions.

An ordinary-wallet withdrawal is limited to 0.001–5 Devnet SOL, an approved
destination, and at least 0.02 SOL left in the source. The connected **source**
wallet signs exactly one System Program transfer. The browser submits it to
the configured Devnet RPC. The admin API records a receipt only after a
finalized transaction proves the source, destination, amount, and exact
recipient balance increase. The app never uses a server-held keeper, referral,
or router key to sign a generic withdrawal. Those roles can only be withdrawn
through this page if the operator independently controls the source wallet in
a compatible browser wallet. There is no general vault sweep action.

The browser polls finalized RPC status without requiring a WebSocket. It shows
the public transaction signature as soon as it is submitted. If receipt
recording is interrupted after finalization, paste that signature into the
reconcile form. The API independently verifies the finalized single-transfer
transaction and exact balance deltas before recording it. A recovered receipt
marks the initiating administrator as unverified.

The gate panel reports launch, collection, settlement, holder, referral, X,
and buyback runtime flags. It is read-only; enabling a gate requires the
existing readiness checks and deployment configuration. Admin audit records
fee-policy edits and verified ordinary-wallet withdrawals in the application
store. The panel links to existing launch, claim, buyback, and analytics flows.

## Daily bonus review and recovery

The Daily bonus panel exposes worker/snapshot status and recovery actions. Snapshots and funded payouts are normally automatic; recipients do not claim. For an unstarted stale snapshot, review the old and replacement hashes and supply an audit reason before reconciliation. Prepared, assigned, on-chain or paid cycles must retain their immutable manifests and require operator review rather than replacement.

The default operations/community entries are 40% / 20% **of the protocol share**, equivalent to 8% Operations & marketing and 4% Daily bonus **of gross creator fees**. The creator-directed 80% is fixed. Editing policy does not rewrite existing mint policies, snapshots, receipts or balances. A healthy gate or successful admin sign-in does not establish a payout or withdrawal.

See [fee configuration](protocol-fee-split-config.md), [Daily bonus](daily-bonus-policy.md) and in-app `#docs/admin` for current scope.
