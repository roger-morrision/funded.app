# Devnet automation through the Helius gateway — November 1, 2026

Verified at 2026-11-01T04:16:12.983Z. The deployed application and financial workers use source `bd621326ecb5defa15f00c4560bd5b50a351e823` and image `sha256:92bcddcf7d49a2729f99c30a080a3d415a8b10963c2f59d77cfd9444cf6a4d2a`.
The public app reports the same build, fresh launch readiness, and verified evidence for all recorded V3 collections.

## Confirmed results

| Flow | Observed result |
| --- | --- |
| Standard launch | Real Pump launches, creator signatures, atomic service-fee payments and exact 3% community reserves. |
| Pro / Premier | [Pro](https://explorer.solana.com/tx/vm7vaYKHzL9XJCHdthB8cPwE547b756YVzNVYYuE5NkPnVa8ec2kpMFsvSdKw2iSSQb1RgTYfhbRuL5Fd8Nm2LD?cluster=devnet) burned 200 $FUNDED; [Premier](https://explorer.solana.com/tx/51ihaRaWSHbB6RPv8jWVELxEo1c6VjM8yoE754JLhMsX5HC6iLTaSmRyRiJC3sUSKrfzBXDmJA5EszP7bWAuxxaK?cluster=devnet) burned 400 $FUNDED. Each burn was atomic with its launch and reserve. |
| Collection and settlement | Two real collections on the main test mint, including PumpSwap fees, settled using authority-fixed policy without a later creator signature. |
| Automatic SOL payments | 19 independently reproved payments: 2 creator, 2 operations, 6 referral, 3 holder and 6 bonus payments. Referral levels 1, 2 and 3 all paid. |
| $FUNDED buyback and burn | [Finalized burn](https://explorer.solana.com/tx/4CKkUnNKX7Q5ibbaoug1uRmp3c3QSF6oHafsrL86g3ujKoqC5vZagL4SrUYwCSnAyoMqCxg8MwDsZ4aWAxg46b8M?cluster=devnet) spent 127508 lamports and burned 16195 base units. |
| Own-coin agents | Both agents bought and burned the launched coin once: [agent 1](https://explorer.solana.com/tx/2uS1ZfnN4AAuHgre1PsgDQvo6xMHqReBx8MbYezHgPcNEmPuCjxBAjuy78ULhsqHJEDYrW8CXkHC9kHN8tEgDqMM?cluster=devnet), [agent 2](https://explorer.solana.com/tx/22aErRG4NavWLPVG3RzVdSufqnnNdvF9KLDT7HGvheRvvb43aDH9Q4MmdzuPvWTZ1jqg68Coj5QVHcG3RWCQPcmX?cluster=devnet). Later worker cycles retained the same action signatures. |
| Migration airdrop | [Real migration](https://explorer.solana.com/tx/s4L23L3PW6tpe4ZKrFuU6kXKFdZj55koiXwG34GLYtRht1K1gypVTjPavzDMW5PdysD5vYJMSRBQgZeAjkAYX7i?cluster=devnet); exact slot 517363009; 19 recipients; immutable root `a50c801ca86d2c4e966bef1270b06f732231ef9f293d6ae9e6ee5aa96b33bd8b`. |
| Holder claim | [Recipient-paid claim](https://explorer.solana.com/tx/3YBCado5t1aPE37zmKgJyZaDH7dNLXkbsGaJvtBbgDPMDdmux8FbCwH4xEafRoTF8zmvRHWARRCngBDzNHiYPTq6?cluster=devnet) credited exactly 76352 base units. Replay and tampered amount were rejected. |
| Expiry | A valid unclaimed proof was rejected after the actual deadline. [Permissionless sweep](https://explorer.solana.com/tx/3RyYwUecXasL9n62bE6fzW76BxzkE1ubrPbnaJapN8nV8xPwYNeJfFAvct8eGNiKwdVhYy5PTLAF32iPLPsoxvbe?cluster=devnet) transferred exactly 29999999923648 remaining base units to the configured app owner; repeated close was rejected. Public proofs retained claimed/expired states. |
| X-linked SOL rewards | Real on-chain payouts passed for both the protected policy and current eight-category agency policy using the explicitly authorized labeled identity. Invalid subject/signature, wallet rebinding and duplicate payment checks passed. OAuth and X publishing were not exercised. |
| Unverified promotion | A local queued-post fixture and rejected-delivery fixture submitted no financial transaction and sent no X post. |

The 19-payment audit totals 1888888 creator, 215873 operations, 26984 referral, 269840 holder and 37562 bonus lamports. These totals exclude funding transfers, buybacks, token airdrops and the separately verified X payments.

## Fixes deployed

1. Completed launches remain registrable after a later global configuration revision. Finalized Pump evidence, the creator signature and the exact immutable mint revision, shares and agent selection remain mandatory.
2. The fee-accrual reader requests native and wrapped-SOL balances concurrently with an explicit quote-token program and a bounded timeout suitable for the shared gateway.
3. Successful collection, settlement and payout stages trigger a short follow-up cycle. Errors and uncertain submissions retain the normal guarded retry policy.
4. Cumulative settlement reconstruction ignores provably read-only policy references. Unknown writable mutations still fail closed. Both actual collection positions were checked before deployment.
5. Verified exact-slot snapshot preparation has a bounded 15-minute response timeout, shares concurrent identical preparations within an API process, and reuses committed immutable manifests. Restart verification reused the same root after the historical replay window had passed.

309 regression tests passed from the exact deployed source. The on-chain ProgramData hash is `f0517fce9b8361be087456be2f5e5547af23b114ca1c0cf4ebaba5a42a8bd9ca`, matching the reviewed SBF binary (`b4189944394dceddbf6c9d116957a5f6185d81a7257f377166e80d1a65388e0e`).

## Test conditions and final state

The main disposable mint used a 100,000-lamport collection minimum and five-minute holder/bonus periods. The two milestone burns used per-mint $1/$2 reference thresholds; the migration case used a 15-minute per-mint claim window. These are QA conditions. The standard $100k/$300k thresholds, hour/day reward periods and 90-day expiry were not reached or waited out in this run. X identity was a fixture; payout transactions and their balance deltas were real Devnet results.

The first disposable mint's snapshot request was interrupted before persistence. Its QA reserve remains recorded; successful migration-airdrop verification used the second fresh mint above, with its true migration slot. No later cutoff was substituted. Snapshot approval/opening used the platform authority, the holder signed its own claim, and the expired close was permissionless.

Normal global terms were restored atomically with each test-policy initialization and verified at revision 8: $100k/$300k milestones, a 90-day community claim window and daily promotion cadence. The active app and workers now have QA overrides disabled, hourly holder policy and daily bonus scheduling. The temporary API-only instance was removed. Concurrent frontend releases were preserved; the active frontend revision is `d183b3e5cce9071979ecdb48af5772dddc8fa09d`.

All active clients use the shared gateway. Only the gateway mounts the Helius upstream credential. Its cumulative counters at completion were 17967 client requests and 9150 provider requests, with 2948 cache hits and 4683 saved account requests. Provider quota rate-limit responses were 0. Intensive verification encountered 1 upstream failures and 26 local queue rejections; the final normal-settings smoke check added 0 upstream failures and 0 queue rejections. Signed actions were reconciled without duplicate payments. Request counts are not a billing-credit estimate.

New participant keys stayed in memory and were not persisted. The dedicated authority retained 4250829706 Devnet lamports. Mainnet was not activated. Changes were committed locally; no push was requested.

Full public transaction evidence and final runtime checks: [acceptance JSON](devnet-helius-e2e-2026-11-01.json).
