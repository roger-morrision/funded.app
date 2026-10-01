# Devnet Pump fee collection and distribution: 2026-10-01

## Scope and chain proof

- Cluster: Solana Devnet; mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH`; mint router `5fbyRAEDqWqvq5Abbqw7NJpGF6fmLJjbEM1oesx7LRpy`.
- The original PumpSwap collection `39p1fhWbapChrLidsfQWknPSCBxkNRrcVtvwyKB2CE6fJiN4Lrurz4UoWhTogaTk51o437nbgT3udTAJeZbWvDeW` placed wrapped SOL in the router's native mint ATA and increased native router SOL by zero. It must not be counted as collected revenue.
- The corrected collector transferred accrued PumpSwap fees to Pump's creator vault before the Pump fee claim. Finalized claim `2vGMKHcur9kBLkvZwcSi7XddG4b2mnhtkhu3bjSP8EKjsNnBJXJegmsE82wjh2kZWXSLEZzRiXhfnexCB76LYcsS` increased the mint router's native balance by exactly **10,291,856 lamports**. This is a fresh on-chain collection from new Devnet trades.
- Router program upgrade `F1fvRFqdE9gwgScXgZeowzZtx1eg5fznWHva3m6og3BrQkXjgkvvgP4J9hSNMXpTSHNwwjy2PzfiD7MbEG55iMx` finalized. SHA-256 of executable bytes: `e9da7cd43232f0997786112c97f339c7b53d425881b66baf6b9dccf7bf85bc16`; SHA-256 of the complete on-chain program data account: `9ce7c1137d250ffa84668e65b53546b7c1d4239eaf888957c41316708cda977b`. The latter is the worker's readiness pin.
- Recovery `DyYE2PW44Vx3Mnt76wvhrpyHg5qffatuTtN9MgzyZqEAxbGmrdrvbPqMzg1JtVE1UyZsqpbQYz4RZMftqjkTQ2R` closed the exact router-owned native mint ATA. Its finalized proof shows **11,780,249 fee lamports** plus **1,488,440 rent refund lamports**. Only the fee amount was recorded and allocated. The ATA is closed. The recovered fee was settled through the same immutable mint policy.
- Post-upgrade Devnet trade claim `3Mc22VBXX6YhckwcLur7MWDwnStc7ZYSeyo8ka8VyWYS1jSeJm8iZp1mgpJHH5KgktEdd5scf87WpQFb7xScNXP4` increased router SOL by exactly **2,660,251 lamports**, showing the corrected collector still works after the router upgrade.

## Confirmed distribution

| Route | Proof | Observed result |
| --- | --- | --- |
| Creator | New payouts `23Q8ofEDvB5XVWWPqiEeyUk4LsFPeJi1QhmYhBhcUxkzxWywtKj3qFTmw7mYy4BP7EAte4LR8KwsFjB7b47FFFsk`, `2sBUrQserijz5tmQxWu5Gv9VtWnnqNi6gFR7Vk1W9B2xTHB7mSWM4CpPMnFdjfb76EV62Jrr2VZ3Dn3hJbcjFTxv` | Recovery allocated 8,246,174 lamports below the 0.01 SOL minimum. The post-upgrade collection added 1,862,176, crossing the minimum. A wallet-signed request paid both allocations, totaling **10,108,350 lamports**; the two finalized recipient balance deltas sum exactly to that amount. |
| Referrals, three levels | Fresh claim signatures `4gcYfDYLXauTjxgRxjs8oAhAknGbdxtDbbovKXmDj2tJLjdSVmQqfjmeSJzAJdrWd41kuvwRLMM1XP1PwX8p5cjk`, `5MkN2KE85tFuAYeeG9vyTM4UhpxM5ZsTkf2d6zyfiebJXwfxP5L5Pog25VnmcVKZX7cjTL8Q2LWpgPEFUjPqQ7bj`, `2B8vRKwQmNst6sWMBGtw2i1gDn2hZqSJ2A5BR8ga3qdsVCevrbkDxDtMZLbwEwYp6XEqTUXLiR4aBHNKtrU25xXq` | 235,605; 70,681; and 47,121 lamports paid to the three exact QA recipients; finalized recipient balance deltas matched. |
| Operations | Automatic reward worker | Recovered settlement allocated and paid 1,649,235 lamports. The post-upgrade settlement paid another 372,435; dashboard allocated and paid totals now both 4,652,605 lamports. |
| Coin holders | Recovery and post-upgrade fee-funded cycle `5Kx9WkMgSqRPpF8UkaWdDEcq3ZUgTwY38yozXwzEuhVX` | Two finalized collections funded 1,444,050 lamports. Three finalized payments `46yQWQTzGt1Bfuc5a3Wdviu2pTUzc7bAFRLNvpELG5PrmpzSGDNXdei5snJxXhWMVtnJCztk6Pur2xwKQJPANiJP`, `4KH4xaLVBUTi4V4su6X9GAjB6LH2T1MZggPa2zJ4dG99dHmFtZJiVh43WUqaFNWpCPXSYmxYKSEirbBNdLodJhcJ`, `45uV4jsZgxmjuJFG1xSdcUuzwWF8ndqepyY16nMkmfMA2hKU16SSWTtzwmwW92meZ1eyFLiojmfQseHMp5n6Jvgk` delivered **1,444,048 lamports**, leaving 2 lamports rounding dust. Independent verification matched both funding claim PDAs, the cycle and payment accounts, and the reward-vault debit from 2,465,135 to 1,021,087 lamports. The daily worker was restored. |
| Buyback and burn | Recovery-funded buy and burn `21gfWSmkzZRsDd5Y5VfZ7JvM15C3W5GEwNBffu66R4ssGrNbYu2QYE7an2W15L9bVSMexbGSYyvKDASvWzWBWMYj`; refund `3cMoUsbPugeBUoxnDatvwF1i15RHuQkzNK2gPF6UPkTtFvzebor8U771YcJXfAa9cppCDix26CVhQ8XxJF8jjVoQ` | Independent receipt verifier confirmed 117,579 net fee-funded lamports and 3,132,006 burned $FUNDED base units. The normal worker schedule was restored afterward. |

The later post-upgrade claim also paid its three referral levels (53,205; 15,962; 10,641 lamports) with finalized exact recipient deltas.
The earlier 8,500,537-lamport collection's remaining referral claims were then paid (170,011; 51,003; 34,002 lamports). Each referral level now shows allocated equal to confirmed paid for this mint: 664,658; 199,397; and 132,931 lamports.

## Open route limits

- The tested mint allocates **0% to X**, so this run does not demonstrate a live X payout. A consenting OAuth-linked X QA account and an X-linked Devnet launch are required.
- Community reserve allocation is recorded, but a finalized community distribution from this fee source has not been demonstrated. The community claim route still needs its own active verified schedule and receipt.
- The 0.01 SOL creator minimum was honored: the recovery allocation waited until a later claim pushed its cumulative amount above the threshold.
- Devnet results do not establish Mainnet readiness. Mainnet deployment remains disabled pending a separate program and service audit.

## Environment note

The first public Devnet RPC upgrade attempt exhausted write retries. Its temporary buffer was closed and all five QA funding transfers were returned with finalized balance checks. The successful retry used the configured Devnet RPC and an explicit temporary buffer signer. A diagnostic command displayed that RPC credential in local tool output while investigating CLI config; rotate the Devnet RPC key before broader sharing of these logs or Mainnet preparation.
