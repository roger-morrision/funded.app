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

The Fee distribution editor changes only the protocol's fixed 20% share. Six rates must
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

### Authority-signed agency policy publication

After the reviewed eight-category program is deployed, its router authority must initialize or update the on-chain configuration. The new-launch referral default is **0.6% / 0.25% / 0.15% of gross collected creator fees**; these are **3% / 1.25% / 0.75% of the protocol's 20%**, with 10% of the protocol share reserved for agency funding.

In Admin, enter the finalized configuration signature, exact on-chain configuration revision and an audit reason under **Publish verified agency fee configuration**. `POST /api/admin/agency-fee-policy` requires the allowlisted admin session and configured origin. It independently verifies the reviewed Devnet binary, router authority, current configuration, and the exact authority-signed configuration transaction before publishing matching rates. A stale policy revision, different instruction, failed transaction or changed configuration is rejected. Repeating an already verified publication returns its saved result. Existing mint records remain intact.

Once agency policy is published, the old off-chain fee form is disabled and its API cannot downgrade the policy. Subsequent rate changes require another authority-signed on-chain configuration revision and verified publication. Launch readiness additionally requires matching program/configuration proofs, an exact-build agency worker heartbeat and the explicit normal-flow activation gate. Publishing rates alone does not prove a referral payment or agency execution.

## App service fees

The separate App service fees editor controls trading on buys and sells (default 0.5%), the SOL service charge on every launch (0.02 SOL), Pro promotion ($150 in $FUNDED burned), Premier promotion ($300 burned), and external coin listing ($300 burned). Promotion burns are additional to the SOL launch service charge. Listing is included for verified funded.vip launches.

Sign in with an allowlisted wallet, refresh the current revision, enter the new prices and an audit reason, then review the summary before saving. Updates use revision/hash comparison and an audit record. Prices are persisted in `adminSettings.serviceFees`; they do not require a rebuild. Trading accepts 0–5% in whole basis points, launch fees 0–5 SOL in whole lamports, and promotion/listing prices whole positive USD amounts, with Premier above Pro.

Each new launch or burn quote snapshots the configured amount. Issued quotes remain valid for ten minutes, and their finalized receipts remain recoverable after an admin price change. Trading reviews use their short-lived fee snapshot. A page already open refreshes on route change; the signing flow obtains current fees before preparing a new quote. The launch charge is included in the atomic coin-creation transaction and verified against its saved quote, memo, payer, and exact treasury credit. The SOL treasury defaults to `FUNDED_TRADE_FEE_OWNER`; `FUNDED_SERVICE_FEE_RECIPIENT` can select a dedicated public recipient.

SOL service charges, app trade charges, and $FUNDED burns are separate from the immutable 80/20 creator-fee allocation. Burning $FUNDED reduces token supply and does not credit SOL revenue to the app. Quotes and allocations alone do not prove collection.

## X publishing review verification

The X review panel requires the signed admin session. Each decision records the
exact content hash, reviewer, reason and expiry in PostgreSQL. A review never
resumes publishing. While the account is suspended, both publishing workers
remain stopped and the persistent `account-suspended` pause remains active.
An empty review queue excludes legacy individual payout announcements; those
records cannot be approved or dispatched.

Run `npm run verify:admin-x-review` for a disposable PostgreSQL and real HTTP /
browser component test. It generates an ephemeral admin signer by default.
To exercise the existing separate QA admin wallet, append
`-- --qa-keypair .secrets/devnet-admin-qa-keypair.json`; the verifier rejects
other public wallets. Keys stay in Node and are used only for the exact local
admin sign-in challenge. The verifier never reads the application database
configuration, starts a publishing worker, calls X, or signs a transaction.
It removes only its own labeled container and temporary files.

The test covers approval/rejection audit persistence, stale content rejection,
a refresh racing an approval, the suspension gate, and blocked legacy or
mention-containing posts. It tests real admin routes and database writes in
isolation, not a wallet extension or a live X post. Live authentication and
queue checks must be reported separately. A refresh during a pending read is
queued so the older response cannot leave a saved review looking unsaved.
