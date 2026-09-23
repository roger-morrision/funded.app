# funded.vip v11 Devnet deployment

Deployed on 2026-09-23 to the existing Devnet Docker origin at `http://127.0.0.1:8788`, behind the retained Cloudflare tunnel and Access policy.

## Release identity

- Build: `automatic-rewards-v11-20260923g`
- Image: `fundedapp-app:automatic-rewards-v11-20260923g`
- Image ID: `sha256:95cd0f4d1883b50292692962381765eda2687ffd8ce4ed97b7a0be31f9c95aa3`
- API: `creator-support-v10`
- Cluster: Solana Devnet
- Storage: PostgreSQL

The app, automatic-reward worker, receipt worker, PostgreSQL, and tunnel were healthy after deployment. The app reports the keeper and fee router configured, and `/api/rewards/automatic` reports `active`. The reward worker reports no readiness reasons. The receipt worker completed its recorded-receipt pass; this is not full-chain coverage or financial execution.

## Solana program

The workspace has one program, `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`. Its finalized ProgramData account is `DrQmTSxHsRACofnAA6oLgfrSxQfLZFDvNmnu3Rz37EVA`, with approved account-data SHA-256 `6e7dcd6f610ef6fd1729a9819d0e173b52932de82985ee870a8d835e7d168740`.

No upgrade transaction was submitted in this release because the finalized on-chain program bytes exactly matched the existing current release artifact: length `304712`, SHA-256 `ed186b14b7154807296713103435b052f0c4ede00dbe002239c3b01340092ecf`. The configured Devnet signer matches upgrade authority `B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n`. A clean build using a newer SBF toolchain produced different bytes and was deliberately not substituted without a separate toolchain review.

The Rust unit test and SBF build passed. The deployed container's read-only verifier confirmed the program remains executable and hash-approved.

## Finalized payout proof

Post-deployment Devnet E2E used only an in-memory ephemeral authority and recipient. No ephemeral private key was persisted.

- Test-wallet funding: `5sL4ku1VTQvPZGb3FtvfLG4EsBB87odjdNxXmN5BK5cUJojK8W6aca5Z6XyD7QADzi5Ent6wcpvYTutdgScfNBFf`
- SOL vault funding: `38nmHaQjoJGQzm4psH6xYJxCiAuxJnBypWMkFqHx6taa1LmJCN4LpUa1buHkctUCb6pUTk6PWsTRYQtHaz2oMVjx`
- SOL cycle: `42p63r4LMDP9t1jy6rocYrsD5HNW9nuf1y1WbCMVHCqhJNgVm6ZRb1mpDtuXerWFXw12iTpY49QnJSVJJCv8c8DL`
- SOL payout: `4vCC9zomRciXVpC94VUi3Cj2BSi9Zyt71vCEi8kmUjs9zitiGyQpHj7KDFxyeYaA91556F7VkpJcu8czqdidDv4i`
- Token mint: `2ZrVyPgpwVTwwjBv7kUJ4zFGGc9vqNodCdwDyQdXeJrH`
- Token vault funding: `3eEBMoxsk1cjbMMBoFVs4NPjxgScVRroBEVPPQRJGvQUVjcLYnHRqJ8r3CfXuCz2DL7YgfGpQGGAnFQNkzYKVo9S`
- Token cycle: `32WtFAs5n5VmoRLoDW4uT9DpjbgL6g8H3sLPk46fkQXuiF791uz2fX9HULnGAvupSxmZX8RJVfGmSQkxtE3qFh1u`
- Token payout: `4tX3LP9tXcCn53hpEGjSvCtsSGvE8EswcWHEy6dQqhHNaCK6yoiu5ywERAiPnHAyyPEMiGMw2NybksMy7Du2dP4M`

The verifier required finalized payment records and exact recipient balance deltas for both assets.

## Test-wallet launch, trade, and reward journey

A disposable Devnet journey used the configured creator, holder, and referrer test wallets with an isolated application ledger. No private key was persisted. The reward period clock was accelerated to a completed one-hour test period; all Solana transfers and confirmations were real and finalized.

- Coin mint: `ZL6f24hG8tjxVshw3RPojKQrgntzT6M8SkkaTZTbKPt`
- Launch: `4R21rgwFJt8GRwUZSso9dPFVswLKBehJy4P4Kp7752WrwkrSXN7Es76zVXkzLNfT83nuEh9PCaXBA559fbi9bydQ`
- Buy: `3iyxGPp37toe4E1XtNud9QcLfgR5L8xuWyTwxmwxbPXrh6vCPYsxAdmP9qToifuqgg3nooQvKUSYvmf7MFSgmRKg`
- Partial sell: `4x3XVtyrsb9A4UgmYF3a3pEEj9Bq4PhzG1gvBLbMTAuYRxwmYDpxYfmDy76CPK4d1BenpAxvEngTSc72eAveheiY`
- Mint-verified fee collection: `teJTvyAgPtYv4YMi6m6sDW3Sd73Rh6YNLtiXSMNqKH34Mhwmeni5yssaYUDQiFzYdvqti5nqmmraQUgQBAyEoLL` (`35,691` lamports)
- Automatic creator payout: `24mZiXJujYAuonF1mw2Z6sJuLgvceicdjCDU93yvDXf7te8AbuXBBuPoxfAVcERAXi4FLe5dKEirZXFtY9fSUVYC` (`paid` with exact vault and cycle deltas)
- Wallet-signed manual referral payout: `1w4yJyHtL3qK9puV1h83Yn1Cr2NBjGBbD4wqMAcJSBStBsVGM1xQCWbiUbG9LMYe8CbWD8uAjJrVXaX37Qg5kPJ` (`714` lamports exact recipient delta)
- Indexed automatic holder payout: `2VqwEyCRwasdWNQoxDVqiv4HchiZiCsLTVE6UkjtbrzJBSEtVLrcXLogQyZFYwiaaBeHZgcWjxDzBukYgSS1DgKx` (`10,000,000` lamports exact recipient delta)

The collected holder allocation was below the configured `10,000,000` lamport automatic-distribution minimum, so the isolated test vault was topped up with Devnet SOL before scheduler execution. A creator self-reward regression test also passed after changing reconciliation to require exact vault and reward-cycle deltas when the payer and recipient are the same wallet: payout `3YmqwinNzJW6KLJYJYPDQkEEETaaXwJbgHgH8oCPJLhHE2PvGAXnJnzFHtMwTX6fiaD8Fk8HmfqAFoRycZyUAZ5F`.

## Backup and browser verification

Pre-deploy backup: `secrets/release-backups/funded-before-v11-20260923.dump`, SHA-256 `62B3E892386C5B409D6FDA2E310C5012BED0E4E70D2A4B2FBFE24D2A75FC78A9`. It restored successfully into a disposable database containing 16 public tables; that disposable database was removed afterward.

The deployed release contract passed for build identity, PostgreSQL capabilities, assets, deep links, chat gate, and concurrent reads. Browser verification confirmed the home benefit headline and the launch workflow's automatic-delivery rules render correctly, with no browser console errors.

The follow-up page-data audit covered every visible route. It corrected the Airdrops page to derive its published program and reserve totals from the same verified launch records used by Home. The deployed page now shows one verified Devnet program and a 30,000,000-token reserve while leaving claimed and eligible-wallet totals at zero until their proofs exist. Referral copy now reflects the live Devnet settlement rules and the separate wallet-triggered claim requirement.

The paid referral receipt was replay-tested against the isolated test-wallet ledger. Re-execution returned the original payout signature without changing the ledger or submitting a second transfer, and the finalized transaction still proves the exact 714-lamport recipient balance delta.

Reward countdown boundary testing covered scheduled, exact cutoff, indexing, prepared, blocked, skipped, invalid, exact payout, negative, and non-finite states. A local-only browser fixture observed the rendered transition from `Reward period closes in` (`00:00:05`) to `Cutoff reached · finalizing holder history` (`00:00:11` until payout), then to `Delayed · awaiting payment confirmation` with an em dash instead of a false timer. The deployed shared ledger currently has zero persisted schedules, so the live Devnet page correctly shows `Not scheduled` while reporting automation readiness as active.

The Explore follow-up adds verified-policy discovery controls: promotion tier, community token airdrop, creator-fee routes to holders, X accounts, or the creator wallet, and ranking by selected-window volume or allocation percentage. Cards show the published percentages, including zero allocations. The live Devnet browser audit used the existing verified `FUNDQA` launch: Standard promotion and the 3% community airdrop remain visible; paid-promotion, holder-fee, and X-fee filters return explicit truthful empty states. Multi-launch ordering is covered by the deterministic Explore verification script because the shared Devnet feed currently contains one verified launch.

## Intentionally unavailable

- Mainnet remains disabled.
- X-linked rewards remain unavailable until approved X OAuth and user-lookup credentials are configured.
- Birdeye is not configured; USD market enrichment remains optional/unavailable.
- Cloudflare Access still protects the public origin; unauthenticated requests correctly receive the Access redirect.
- The reward worker currently has zero registered programs in its new shared ledger. Verified future launches with a holder allocation register automatically.
