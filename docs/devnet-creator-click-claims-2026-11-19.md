# Creator fees: signed-in click-to-claim

Deployed to funded.vip Devnet on 2026-11-19. After wallet sign-in, clicking **Claim** pays the creator's finalized fee allocation automatically. The app authority signs and pays the network fee. No additional creator transaction signature, claim-message signature, or OTP is requested.

The server requires an unexpired wallet-ownership session matching the saved launch creator and the correct app origin. Client-supplied amounts and recipients cannot change the entitlement. Protected on-chain policy, finalized settlement, allocation reconciliation, receipt and balance checks remain mandatory. A worker cannot initiate this user claim. Administrative residual transfers retain their separate approval path.

## Release and checks

- Source: `181d3c9498b8d104f50d646d7a5a01e78fec327f`.
- Accepted release: `181d3c9498b8d104f50d646d7a5a01e78fec327f-ce495ed1-d242-48de-9631-6c66f769bb8a`.
- Image: `sha256:1f1f246a783bd65c0460ea538146f57c9706445a70ef42b73175c171e35cdbe1`.
- Signer enforcement: `all`. Program allowlists, treasury caps and the separate price signer budget are unchanged.
- 56 tests passed locally and in the exact release image, covering creator/referral authorization, duplicate and concurrent claims, the creator button without wallet signing capabilities, receipt validation, and admin OTP withdrawal checks. Source checks and the production build passed.

## Live Devnet evidence

Fresh QA mint: `8kGfSp6GuyM6dFgKCphxoRVsGfrmVicZgySsLZ9oPWMA` (`QCREAH4X6`). Ephemeral creator and referral wallets signed in once. Normal trading, collection and settlement produced real fee allocations; no entitlements were edited.

Creator payout: **150885 lamports**, finalized at slot **523931907**, transaction `qCN1iswJREzm4NFBMX5oVcNUeDs8FpASL8DdGViogbrNRug6YDXNrju6PVAvex2CMR2oEuFek9nTsHQeVAHQDf5`.

The claim POST used an empty JSON body with the existing session. Independent RPC verification confirmed the exact recipient credit and category-vault debit, protected instructions, immutable withdrawal receipts, applicable approvals and policy counters. The transaction had exactly one signer: the app authority. Its digest matched a successful signer journal entry with no violations. Retrying returned the same transaction signature and paid nothing twice.

All three referral levels also paid successfully with one app signer and no per-claim signatures or OTP; replay requests returned their existing receipts. Live checks rejected missing/revoked sessions, the wrong creator wallet and an invalid origin. The successful fixture refunded all remaining SOL from its four disposable wallets, verified at zero balance. The live harness exercised deployed HTTP routes; the button itself was covered by release-image tests, not a live browser click.

An earlier fixture hit RPC rate limiting before claim verification. Cleanup also failed, leaving **0.359495942 Devnet SOL** in its four disposable wallets. Their keys existed only in process memory and are no longer available. A second attempt stopped at readiness checks before funding. These failures and the successful run are retained in the evidence.

## Scope

- Creator and referral claims: click Claim after wallet sign-in; app signs and pays automatically.
- Admin vault withdrawals: admin wallet session, action-bound email OTP and admin transaction co-signature remain required. No successful live admin withdrawal was executed in this run.
- Mainnet: activation remains blocked. Read-only checks confirmed its unchanged build/container start times, disabled agency buyback flags and absent price signer configuration.

This release supersedes the creator co-signature requirement described in the earlier referral claim release record.

[Public evidence and transaction signatures](evidence/devnet-creator-click-claims-2026-11-19.json)
