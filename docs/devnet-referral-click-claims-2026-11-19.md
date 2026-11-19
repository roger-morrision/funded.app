# Referral rewards: signed-in click-to-claim

Deployed to funded.vip Devnet on 2026-11-19. After wallet sign-in, clicking **Claim reward** sends one request and the app signs and pays the recorded referral entitlement. No additional claim-message signature, transaction signature, or OTP is requested from the recipient.

The server requires an unexpired wallet-ownership session, the correct app origin, and a session wallet matching the immutable referral recipient. Client-supplied amounts and recipients cannot redirect the payout. Finalized settlement, allocation, approval, receipt, budget, and balance checks remain mandatory. The normal worker cannot initiate these user claims. Concurrent requests and later retries preserve one payout receipt.

## Release and verification

- Source: `9f55d5673ad5da92dc4fe64f71ba1e949275c619`.
- Accepted release: `9f55d5673ad5da92dc4fe64f71ba1e949275c619-a022d2b2-8c53-451f-a86f-b83613cd85cb`.
- Image: `sha256:767a77cb7a024ded750218009800b7d2cdeb4d69b45ab745fd8a7de1653bc415`.
- Signer enforcement remains `all`; existing program allowlists, treasury caps, and the price signer's shared 2 SOL/day cap were preserved.
- 34 tests passed in the release image, including referral authorization, all three levels, duplicate/concurrent claims, client receipt checks, and admin OTP withdrawal regression tests. Two additional wallet-session/history tests and source checks passed; the production browser build passed.

Live tests created a QA mint through the normal launch API using an ephemeral creator and three ephemeral referral wallets. Initial wallet sign-in established the sessions. Real Devnet trades generated fees; the regular fee collector collected and settled them without editing entitlements or bypassing funding rules.

Mint: `8a1o2LmBHX5kqtBfVsDgHhiTzfgehppNiyZX1x2BNhqQ` (`QREF9LE33`).

| Referral level | Paid lamports | Finalized slot |
|---|---:|---:|
| 1 | 2,263 | 523925435 |
| 2 | 943 | 523925507 |
| 3 | 566 | 523925587 |

Each claim used an empty JSON body with its existing session cookie. All three finalized with exactly one transaction signer: the app authority. The app paid the network fee. Independent RPC verification established matching category-vault debits and recipient credits, exact instructions, immutable withdrawal/approval receipts, and policy counters. Transaction digests matched successful internal-signer journal entries with no policy violations. Repeating each request returned the same transaction signature.

Live HTTP checks also rejected missing/revoked sessions, a different authenticated wallet, and an invalid origin. The admin withdrawal endpoint still required an admin session. An initial fixture attempt encountered transient launch-reserve readiness failure before launch; its funded wallets were refunded. After the successful run, all four ephemeral wallets returned their remaining SOL and had zero SOL balances. Private keys were never persisted. The QA mint and its finalized records remain on Devnet.

## Current automation boundaries

- **Referral rewards:** user clicks Claim after signing in; app signs and pays automatically, without per-claim wallet approval or OTP.
- **Scheduled payouts and buybacks:** workers execute eligible, funded actions under their existing policies.
- **Creator wallet claims:** existing creator transaction co-signature remains required; this change only removes the extra referral-claim signature.
- **Admin vault withdrawals:** admin wallet session, action-bound email OTP, and admin transaction co-signature remain required. A successful live admin withdrawal was not executed in this run.
- **Mainnet:** activation remains blocked. Read-only checks confirmed the unchanged Mainnet build and container start times, disabled agency-buyback flags, and no configured price signer.

The earlier manual-signer verification record describes the old referral claim-message flow. This release supersedes that requirement for referrals.

[Public evidence and transaction signatures](evidence/devnet-referral-click-claims-2026-11-19.json)
