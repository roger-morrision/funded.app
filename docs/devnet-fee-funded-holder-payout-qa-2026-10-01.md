# Fee-funded holder payout QA — 2026-10-01

## Scope and safeguards

Mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH` had an existing finalized Pump creator-fee [collection](https://explorer.solana.com/tx/2WE8nJ3iTm8DixxUsxF9tr4kYqG7xZRoZi6pVYikFPw8ZKaMzMiTd3NnHQBTRnBiSAqDp5vp9sgHbrWdpeHen8zF?cluster=devnet) of 8,500,537 lamports. Its published holder allocation was 850,054 lamports. A separate finalized [mint-router settlement](https://explorer.solana.com/tx/Tsto6M3spBfDDzAcP3RG6BSRVA2wXxkUf3KM1wU3boZyf8s3iGBh7SxkaeSzR4uaJiwy1GrN41GxjvREk5ooZD6?cluster=devnet) moved exactly that holder amount into reward vault `HZwtGTtJ6xmrvfeMwWccbUwMwvdd7Nk5fK27i9DdfMbE`; its on-chain claim record is `DrF1MFnmJWksAe5VonZDBpBoUDHFwEfR7YMKLMkiBs5G`.

The normal holder payout minimum is 10,000,000 lamports, so this fee-funded pool would carry forward. For this Devnet test only, the reward worker used a 300-second period, an 800,000-lamport minimum, and the exact mint above. The source guard requires Devnet, the short-period flag, the matching mint, and a minimum between 100,000 and 10,000,000 lamports. All other mints and Mainnet retain the normal minimum. The existing daily schedule remained indexed during the test. No QA wallet added SOL to this fee-funded pool.

## Finalized result

The period ran from 02:05 to 02:10 UTC with finalized holder snapshots. The worker assigned the single verified fee pool, created reward cycle `6byXVnFP5ovcfXndxEG89Sa2AKmLiSeFtvi3u9qMEwuZ`, and finalized three payments:

| Recipient | Lamports | Finalized transaction |
| --- | ---: | --- |
| `7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk` | 23,437 | [61DBrPuD…](https://explorer.solana.com/tx/61DBrPuDVUxXJwVohmc5uhAsyNyshXdDtGAntLHRzR5cArSGHxPWSVWFck7F6LVoZvbSH6vDzgFr9eKfHtFamTz6?cluster=devnet) |
| `8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk` | 795,348 | [4M9f74n2…](https://explorer.solana.com/tx/4M9f74n28PHEU35KFn9s3coTxmd3arQBtSXogbBCXdphLXtdUgV4RQj7VYz1cm9ZwoYEjwDumbDrtfKbqeJ5JNrp?cluster=devnet) |
| `CRRaMRKxThkTUUMj9DrshBxDWbcVRdTgWj9ubbMnXTm7` | 31,267 | [J23DEv9D…](https://explorer.solana.com/tx/J23DEv9D4GDtdDfjLEq8Vd5A8GjQmjmpeR3zD86iUPNGj4HSrw45fw2cnPxrV2VL6W1eXEg84hxayJbmwCUSGJR?cluster=devnet) |

The payout total is 850,052 lamports. Two lamports remain from integer allocation rounding. The vault's finalized balance fell from 1,871,136 to 1,021,084 lamports, an exact 850,052-lamport debit. The canonical PumpSwap pool received no payment.

`scripts/verify-fee-funded-holder-payout-devnet.mjs` independently checked the public verified collection receipt, source and funding transaction finality, exact on-chain mint-router claim data, pool-to-schedule linkage, cycle distributed amount, all three payment accounts, recipient exclusion, and vault delta. It returned `verified: true`. The public reward API reports `holders-paid`, `verified-fee-funded-cycle`, and three holder payment events with `feeSourceVerified: true`. The external token page displayed all three payments and source-claim links at mobile width without a page error.

Immediately after the paid result, the worker was restored to image `fundedapp-app:qa-reward-pool-exclusion-v2-20261001` with its 24-hour period, five-minute sampling, one-hour payout delay, and 10,000,000-lamport default minimum. The original daily schedule remained `indexing`; the QA pool is `assigned` only to the paid cycle. The pre-test and post-test ledger snapshots are under ignored `tmp/` files on the QA host.

## Recheck

```powershell
node --env-file=.env.local --env-file=.env.deploy scripts/verify-fee-funded-holder-payout-devnet.mjs tmp/qa-fee-holder-ledger-after.json FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH 1790820300 1871136
```

This is Devnet proof of a fee-funded holder payout. It does not certify the Mainnet program or the unrelated community and buyback custody paths.
