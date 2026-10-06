# Devnet remaining-flow verification, 2026-10-06

Scope: `https://funded.vip` on Solana Devnet, using only the rotated QA wallets. The live app served source `f9ca36c014c83671c3d278d87cc7a3c45471b304` during these transactions. A later deployment of the tracked Boost gate and QA preflight changes must be verified separately.

| Flow | Finalized evidence | Result |
| --- | --- | --- |
| Community token claim | Mint `D38hD6LE73ZAwDwTnB2XNQBLFQc7zx1DxVb9gYLFoKzH`; QA referrer `7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk`; signature `5FTKc4qaskQMQTUrEEihHfy9nPSYtU1f62Pb752mnXH4nrvyuXVunUPrRsCDCej6JoSfyWLbxyZWTZVx8wMPRKSq`; token-account delta exactly `313720287` base units; public proof changed to `claimed`. | Verified |
| Boost purchase | QA mint `CQjsVURiWELsbqj2pbGL7ga9oKiNemUk5bZzB6dLoMaH`; 10x quote `826308322` lamports; signature `2Xtw9ykXqRV6YB8r7hDAjkWGevoUmtRy5PpGVSsgPNkgs5duL9AQCfpYhiFHdrtVHyc8Xjno1qLEpjgjaVHibHG3`; recipient delta matched quote; public `/api/boosts` showed one active 10x package. | Verified |
| Fee collection | QA mint `D38hD6LE73ZAwDwTnB2XNQBLFQc7zx1DxVb9gYLFoKzH`; controlled PumpSwap trades increased the verified vault accrual to `14722832` lamports. Collection `4BJ9RLBJSKvEsTDpUgRRN6URyxGNZtCup9sqRQdAdWSU7LJ3ucaDiThKqnN27drZnxcraUSGq1SwqWXCkbasvxQB` recorded the exact `14722832` lamport router increase and mint attribution. | Verified |
| Referral claim | Direct QA referrer claimed `294457` lamports from that collection. Payout `4MPfQ1ZRKL8viQmXU24VVpjZssNjgB73E8qgWTK7r5SEY53mYSbMkbsZirXMRbJZbgZwrPG4sMFRsEDKRHaqWfoV` finalized with the exact recipient delta. | Verified |
| Creator claim | Creator signed a claim for `10305982` lamports, above the unchanged `10000000` lamport minimum. Payout `TVtA9XAAejp29V8KrCXXwPVUf6srU6ZmuYrXWuJ7rvpwqTijoTjkV1zvBm7C9VzcLcS5F2Zz1hMJdWcL5u4uryd` finalized with the exact recipient delta; public fee activity reports it paid. | Verified |
| X launch post | The `@fundedvip` posting credentials and account ID `2106988525900144640` were verified. The durable outbox contained exactly one reviewed `[Devnet test]` launch post. After explicit user approval, one dispatch returned provider post ID `2107375555268243577` and [the public post](https://x.com/i/web/status/2107375555268243577); outbox status is `posted`, attempts `1`. | Verified provider receipt |

The `1472283` lamport holder share from this collection is funded and indexed into the `D38h...` daily holder schedule. Its cutoff and payout are set for **2026-10-08 00:00 and 01:00 UTC**. It has no paid recipient receipts yet; do not report the holder payout as verified until the scheduled cycle runs and final balances are checked. The existing recurring QC/QA job can check this on a later run.

The X fee claim for the separate QA mint `7cuCDDa6e5Jx1gvxwTug5zhDE82L4HoTRnR1KTB7R4CA` remains unverified. Its recipient is `@JohnTrand83` and its recorded collection is `234805` lamports. A real recipient OAuth sign-in and wallet binding are required before payout; posting credentials for `@fundedvip` cannot substitute for that recipient.
