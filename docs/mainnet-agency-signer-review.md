# Mainnet agency signer review package

Status: activation blocked. This package provisions no keys, starts no service and authorizes no transactions.

The public review worksheet is [mainnet-price-signer-review.json](../config/mainnet-price-signer-review.json). It is deliberately not a runtime signer configuration. The production program release still has no reviewed identity; see [mainnet-program-release.json](../config/mainnet-program-release.json). Fill public evidence only, never secrets. The proposed daily ceiling is 2 SOL and per-order ceiling is 1 SOL; a reviewer must approve these limits and the permitted routes.

Before activation, the operator and independent reviewer must:

1. Pin reviewed production program bytes, source revision, upgrade authority, RICH mint/pool and application authority. Bind the signer review to that exact release and its Mainnet genesis identity.
2. Provision a separate Mainnet signing key, HTTPS service, authentication token, independent RPC and durable journal. Do not reuse Devnet identities, credentials or reservation storage. Record only the public signer identity and endpoint in the worksheet.
3. Review network-bound changes together: price-signer bootstrap/config and health; price review and on-chain signer activation; app cosigning; agency deployment, custody, execution journal, worker discovery and readiness. These paths currently enforce Devnet. Do not remove a single guard or redirect a Devnet RPC to enable production.
4. Verify own-coin milestone checks, protected payer reserve, canonical pool/custody, quote and daily limits, append-before-sign durability, expiry reconciliation, restart recovery and replay rejection on isolated Devnet fixtures. Attach evidence; local mocked tests alone do not satisfy this gate.
5. Prepare the reviewed Mainnet rollout with key isolation and rollback. Activation requires a separate explicit operational approval after review. Verify the finalized price-config account and exact deployed program before allowing any purchase. A production acceptance purchase additionally requires explicit authorization and finalized vault debit, supply burn and immutable receipt evidence.

Keep activationBlocked true until all evidence exists and the separately reviewed implementation and rollout are approved. The worksheet is not consumed by the current Devnet service, so changing it cannot enable Mainnet signing. Never clear a journal or increase a budget merely to bypass a failed review.
