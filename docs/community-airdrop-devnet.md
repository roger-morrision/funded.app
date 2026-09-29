# Community airdrop Devnet status

As of 2026-09-29, six verified Devnet launches publish 30 million token community allocations each. A published allocation is not proof of custody or claim eligibility. All six legacy reward-vault PDAs have been initialized and verified on Devnet. Initialization does not fund a vault.

The existing 7T5zHPcAczpYeaDjT4HQRD8Gi9YmGi5fr2yN7d3PQTez launch has 30 million tokens in reward vault `7vwuYtSaVpFBgxfy1fmVLdNhbdKASHyWHnb3iSUk6yPt`. Its finalized funding transaction is `4JjKBpkYQC8PshXXhEQ3X6v7hLhmAtSbHXmdWuUb3eG2WwB26AH2nxsPvHXBFcX45742TfRWfE5KCH4V2GFHTjcY`. The API checks the approved reward program hash, vault owner and PDA, token account owner and mint, current balance, creator signer, and exact 30 million token source and destination deltas. The other five launch reserves have no verified funding receipt or balance. Their claim controls stay closed.

The local application now offers the verified launch creator a wallet-signed full-reserve funding action. It checks finalized source and vault deltas and records an immutable receipt. This is a custody step only. The six initialized PDAs and 7T5 funding are live Devnet observations; the new funding UI/API is local code until deployed.

A fresh dry run with the configured Devnet reward-authority signer rejected reserve funding for both its other launches, GnWA and Y5: that wallet does not hold the full promised amount for either mint. No transfer was submitted. The Asx, GVu, and 7QYn launches belong to other verified creator wallets, whose signatures are not available to this server-side signer. They must use the creator-signed wallet flow after it is safely deployed or provide independently verified funding receipts.

## Eligibility and claims

Claims remain closed for every historical launch. The 7T5 launch has not migrated, so no migration-time $FUNDED holder snapshot exists. The already migrated Y5 launch has no saved exact-slot holder snapshot. Current balances cannot establish historical eligibility. Y5 claims stay closed indefinitely unless independently reproducible exact-slot evidence is recovered. A later snapshot is not authorized as a substitute; changing that rule would require a separately published policy before any Y5 claim opens.

An additive contract candidate in `contracts/funded-fee-router` implements a dedicated funded community vault, immutable migration slot/signature and snapshot commitment, Merkle allocation root, one payment PDA per recipient, exact payout deltas, 90-day on-chain claim expiry, and a remainder transfer to the recorded app-owner reward-authority wallet. Its locally built SBF artifact has SHA-256 `85420269c25b579e91e795c5ca1a73d25354b464bae561cb1bd4ac620f5ebcf2`; this is not the deployed ProgramData hash. The matching `community-merkle.js` builder rejects incomplete or later snapshots and produces deterministic proofs. These are local candidate code, not an activated Devnet claim program. The contract accepts operator-attested historical data; it cannot itself prove that an archival holder list was captured at migration. A verified exact-slot archival source and independent manifest review are required before a cycle can open.

The app owner has chosen the reward authority `B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n` as the destination for all unclaimed tokens when the 90-day window closes. The contract records that address at initialization, requires it to equal the signing protocol/reward authority, and permits closeout only to a token account owned by that address. The prior growth-reserve wording is superseded for new cycles. The exact account and program configuration must be reverified before deployment; any change of app-owner wallet requires a separately reviewed policy and contract update.

## Remaining acceptance evidence

1. Obtain the creator-signed, finalized 30 million token transfer for each historical launch that retains this promise. The existing issuer wallet is not automatically the creator wallet. Do not use another account as its signer or silently reduce the promised allocation.
2. Capture a complete finalized $FUNDED holder account state at the exact migration slot for a fresh launch; verify the migration signature, mint, slot, block time, total supply, exclusions, allocations, root, and each proof from independently reproducible archival data.
3. Review and deploy the exact on-chain artifact to Devnet; pin its ProgramData hash and update the API only after verified deployment.
4. On a fresh funded launch, verify eligible payout, ineligible rejection, duplicate rejection, expiry rejection, and post-expiry vault/recipient/remainder deltas from finalized transactions.
5. Keep Y5 and all unsupported historical claims closed until their evidence is established under a disclosed policy. Historical Devnet reserves need not be copied to Mainnet.

`npm run community:vaults:devnet` is a dry run; `-- --execute` initializes missing verified vaults but moves no tokens. `scripts/reserve-community-airdrop-devnet.mjs --mint=<verified mint>` is also a dry run; `--execute` is limited to issuer-controlled mints and cannot impersonate another launch creator or create eligibility. Never use a later holder snapshot as a substitute for a missing migration-time record without an explicit policy change.
