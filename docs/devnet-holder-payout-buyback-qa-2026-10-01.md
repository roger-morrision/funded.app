# Devnet holder payout and buyback QA — 2026-10-01

## Holder payout: issue found and corrected

Mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH` used a separate QA ledger with a one-hour period (2026-09-30 23:00 to 2026-10-01 00:00 UTC), 300-second holder sampling, and zero payout delay. The live reward worker's finalized holder snapshots were copied into the isolated ledger; no public reward program or payout schedule was changed. The test then captured another finalized holder snapshot before cutoff. Direct QA authority funding sent exactly 20,000,000 lamports to the mint's reward vault in transaction `2eahBNQ5jtSdpsap9nRtFu6t5v4eEPDXZLtBi3vbPVPc82vVvvuiYkRZRcicRQ3WjerQ3hB3FVDG8y6yHwNEnex`. This proves the scheduler and on-chain payout path, but the funding source was a QA wallet rather than a collected creator-fee settlement.

At cutoff, the scheduler used 14 finalized holder snapshots, created cycle `7jT46hTtkDQTdv1KZe1dzfqzW5yjJtkrtPwoXzvsJyen` in transaction `499VD4z4oBzcaXgSck59cY3H1FFTGaqrEZ46WG3sPer3gqLDcBBYdgVBgxduZJNhDRzWsQqQ9sdhdS9bHuPg879W`, and paid three holders:

| Wallet | Lamports | Finalized payment transaction |
| --- | ---: | --- |
| `8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk` | 15,823,236 | `5XAGUnMC1L9oLy76ySRA8XGEvrDkr36n6C2C4AKb4539FE4C54Py5ChFj5mTfPDvYWeU2xanPx3MDzYpbrXowh5h` |
| `CRRaMRKxThkTUUMj9DrshBxDWbcVRdTgWj9ubbMnXTm7` | 622,063 | `6My91GXxRPkWNcNiUTzKXne6vaMf1t84NsfvnUAJzShowErHV9WWy5Gcm5VzMHu3H1qBufQYkyQXFKWJ8uYAyY6` |
| `Fz1ePYEvwrWz7GoxZ83qvWJ4Ent3NsRygsv3Tq57MVcq` | 3,554,700 | `UfNgtDaH1FF9rC5Ga7sLaQKJhGt7PWbyTjCti1445ffLSNuaPzDYDpubcA95E8CSAW852zbgz8953aE7CfJ3UiB` |

`scripts/verify-holder-payout-devnet.mjs` independently checked the finalized transaction statuses, all three payment account owners and decoded recipients/amounts, and the on-chain cycle's distributed amount. The payment total and on-chain distributed amount both equal 19,999,999 lamports; one lamport remained undistributed because of integer allocation rounding. **This first payout revealed a real bug:** the third recipient, `Fz1ePYEvwrWz7GoxZ83qvWJ4Ent3NsRygsv3Tq57MVcq`, is the canonical PumpSwap liquidity pool PDA. It received 3,554,700 Devnet lamports as though it were a wallet holder. Those lamports were not counted as a valid user reward in the corrected result.

`server/reward-scheduler.mjs` now excludes the canonical pool when calculating holder weights, including programs registered before the change. It also blocks an already prepared holder manifest containing that pool before creating a cycle or paying a leaf. A Devnet-only `FUNDED_QA_SHORT_REWARD_PERIODS=true` switch permits 300-second test periods; the default and all Mainnet schedules retain the one-hour minimum. The final corrected module was packaged into image `fundedapp-app:qa-reward-pool-exclusion-v2-20261001`, and only the public Devnet reward worker was recreated. It reported healthy and captured new snapshots.

A second isolated QA ledger ran the next 300-second period, 2026-10-01 00:05–00:10 UTC. [Vault funding](https://explorer.solana.com/tx/4cAY1o77EFM4VAe82STquTA2Z2RDmDwKPyb5LWY6adhPMC6xyt2c8ZomFRZQBQN6SKrgdbqWt6mSuUa4g9zNGjwZ?cluster=devnet) transferred 20,000,000 lamports before cutoff. Three finalized snapshots covered the period. [Cycle creation](https://explorer.solana.com/tx/1eEvNmuiLMydwq3o27f7tps43tB6ZiUUmvhJPCN2XCphhANZVWhVWaqnvjNeqRh1MRJ7YGTgAcSCZ2cv4KjqpWs?cluster=devnet) and two [wallet payments](https://explorer.solana.com/tx/5sMEZZFqwRxXFEfyS4srQAihdo9MCwdHxBAzCm5gzAZ6Vzf1R7wyZPVwnZJm7f7M2Ypp8bhGPmeEQMEW9YtawRC5?cluster=devnet), [second payment](https://explorer.solana.com/tx/22h8bbY63uTjejC4xakX3SU4vtziXR7WXytk9mdjUgFFzZe75W4qn6t5DU33yTXf5gmh9BsCLw7ggKmwFTET2PRL?cluster=devnet) finalized. The creator received 19,243,476 lamports and the other holder 756,523 lamports. The pool received none. Independent payment-account and cycle checks confirmed exactly 19,999,999 distributed lamports, with one rounding lamport left in the vault.

## Automated buyback on the new mint

Two bounded QA purchases in the verified PumpSwap pool finalized: `24XLDaM45o1xgarweiNv4QyUoNEGhBUNZ2xdgpDkWjDBcSBToX1t31qFBmENuF194eo2kUKjqpJRALKwsRX9C5a1` (0.5 SOL) and `5JERvpX7NNpTmAN7CfKUR89GsAbTbz4kHPRiTVVu9TkXHTtpLa4Xdn4wnz6Div5XnQwBepEpc5U1Qbw1jxfm9STV` (0.02 SOL). Each increased the QA trader's token balance by the quoted amount. The mint's Pump vault then exceeded the 10,000,000-lamport collection threshold. At 00:14:48 UTC, the live fee collector reported one collected and settled [claim](https://explorer.solana.com/tx/2WE8nJ3iTm8DixxUsxF9tr4kYqG7xZRoZi6pVYikFPw8ZKaMzMiTd3NnHQBTRnBiSAqDp5vp9sgHbrWdpeHen8zF?cluster=devnet); the token fee API recorded a mint-verified 8,500,537-lamport collection and an 85,005-lamport buyback allocation.

For this test only, the buyback worker used an explicit 60-second maximum wait for `FWmi...` on Devnet and a 60-second scan. The source guard requires both Devnet and that exact mint. The worker automatically submitted [the buy and burn](https://explorer.solana.com/tx/2QMWeJmahR8DVCbvbFwZe3NWDrFB8An4we73etaaM8JQKXbnR59TbJPgwMdWgUWYzh4TnXYmv2p4gSjbTAMUkL1y?cluster=devnet), then [the refund](https://explorer.solana.com/tx/5RWFZMxZYDZX1HyDNxXYpzvhDTrp36V86ioj9h7giZnbiNFB2sqRnAwhLVN6P6vRiAaWi1kR8rVAkSobKoYfdjrb?cluster=devnet). The receipt is finalized: 2,232,461 $FUNDED base units burned, 834 lamports returned, and 83,754 net fee-funded lamports spent. The existing on-chain receipt verifier checked the mint-router claim, exact router debit, pool/operator token deltas, `BurnChecked`, supply decrease, and refund credit. After verification, the live buyback worker was recreated on its standard image, restoring the six-hour wait and five-minute scan.

## Other automated buyback receipts

The live Devnet buyback worker processed verified fee-backed orders and finalized their refunds. The existing `scripts/verify-buyback-devnet-receipts.mjs` checked each receipt against the on-chain mint-router claim, exact router debit, PumpSwap token movement, atomic `BurnChecked`, supply decrease, and refund credit. It passed for all three receipts:

| Source mint | $FUNDED base units burned | Finalized buy and burn transaction | Finalized refund transaction |
| --- | ---: | --- | --- |
| `Cg95LJcnH18e34ivwTk71iexiFHKPwQ19MQC5LEBP5Ba` | 143,264,463 | `2WqFVxQeZn28DLNEu7VzDdpxgYYumqE7R3YWErwFXUBYS4FL2PXXmipc9ACVws7B1hEXfiWndtzqRJN2cw1guHrX` | `5DyKGatLkirtMUaRPA4kZpH855ibEBFLzZxwNPpF6gFZ7gpVic29tNbK8uR837yA491GUusg2rhPXiEvm6nWLd4b` |
| `3WF4YwLtwcVJ738tNKgqsPXMBxYSrosPZ316HSNkvbaZ` | 23,338 | `2sZwfTmumzjus8Frrtvk4EE2bsNGRjVQDys5xhg5y3U5wYLdf7a6MswWrwkPHWDBB2g7xkbEqeqY2ZD8EJG6GjBU` | `5fXgubya2AHnx46afi6ajr5yujpnKrDm61TeSjFnT3KC5C2xcmMXzyRUVeDbvcb29fV8S2kmB4TrjFDnfwT3EU2T` |
| `5D6NrzqP94RdCjnyJan44AGxJF1fANjkVWDa6G4HtTBC` | 4,698,116 | `3kHXAaJUaVv9ko7rtCEMeqyZXvZaXdZD8TMyvyCJdfeHRYAKidVkciG4jcLwwbhKR6uPv6p2kDcPHBrzAjfvczRC` | `43FJhGCigDw7XpSEMEoTcfEcAY3BM7YBdWD1vdDdoEPzNkoLEY2iKK9gb8qvyrMAWEJwis2TkG1SjYK2kFUM5Whe` |

The prior receipts above provide regression evidence. The fresh-mint receipt in the preceding section is the end-to-end result for this run.

## Recheck commands

```powershell
node --env-file=.env.local scripts/verify-holder-payout-devnet.mjs tmp/qa-holder-qa-ledger.json
node --env-file=.env.local scripts/verify-holder-payout-devnet.mjs tmp/qa-holder-pool-exclusion-ledger.json --expect-no-pool
node --env-file=.env.local --env-file=.env.deploy scripts/verify-buyback-devnet-receipts.mjs
```

The QA ledgers and copied snapshot sources are under ignored `tmp/`. The scheduler harness is `scripts/qa-holder-fast-payout.mjs`; it checks the Devnet genesis hash and the expected QA authority before sending any transaction. It uses `setup` once before cutoff, then `run` at or after cutoff. Set `QA_HOLDER_MINT`, `QA_HOLDER_SOURCE_LEDGER`, and `QA_HOLDER_TEST_LEDGER` for another mint or period. For a 300-second Devnet-only test, also set `SOLANA_CLUSTER=devnet`, `FUNDED_QA_SHORT_REWARD_PERIODS=true`, and `QA_HOLDER_PERIOD_SECONDS=300`.
