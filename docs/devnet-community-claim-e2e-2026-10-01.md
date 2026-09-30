# Devnet community claim end-to-end verification — 2026-10-01

Scope: newly created QA tokens on Solana Devnet. This record does not establish Mainnet readiness.

## Program and rollout

- The reviewed Anchor 1.2 SBF binary (`d6cd394bc144ea58c9f1d5feac3c829757da36e3c3d8e064e336db3dc909d4b7`) passed the isolated Agave 4.1.2 instruction test. [Devnet upgrade](https://explorer.solana.com/tx/QC1x28oecHtDEAMiTgxYsEUHUebWV5NWSeEGn3cGqM9gmjvxP2mz6dYmA7K6cUJUoWnJJMfuxS9iXeLQxfLiG6z?cluster=devnet) finalized for program `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`. Finalized ProgramData SHA-256 became `ef4ec9e95f5bfdc90718abc73d7e412e88078e4f997a889fe7346964b94eabe2`; upgrade authority remained the separate app owner `3NMjsHsau8uw598UKZqbKq8dhFjGMEYpdx5wU72Kfh1P`. The previous ProgramData bytes were backed up in ignored `.secrets/release-backups`; the upload buffer was closed.
- The public Devnet app, reward worker, and buyback worker were recreated with that pinned hash. The opt-in community claim worker started. The app health endpoint reported `ok: true`, fee router and automatic rewards ready. The claim worker reported `ready`. Only Devnet was changed.
- To preserve the existing public UI while the checkout contains unrelated edits, the app image was patched from the already running public image. The current live app image is `fundedapp-app:qa-community-cache-v4`, the claim worker uses `fundedapp-app:qa-community-dust-v3`, and the reward worker remains `fundedapp-app:qa-holder-index-20260930`. The app now invalidates its reserve index immediately after a verified new launch. Reconcile the public UI source with committed code before any future full image rebuild.

## Fresh token and finalized claim

| Step | Evidence |
| --- | --- |
| Launch and register | New mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH`; [launch](https://explorer.solana.com/tx/5Rs9wsB3Pp1rrKMc6RNohmjUDWBypwi5vnTGicgEoV3bcTkSSPSLteVBbQ2UCoAfcZ49QoxU2H8a3tJJihfg2UQq?cluster=devnet) finalized. Registry recorded the 3% community reserve and verified mint-specific fee router. |
| Fund community reserve | [Transfer](https://explorer.solana.com/tx/3nauE1HuT3Df1zaEBaPwpShadLfdazEswwq5ye6UHtraDPnyEe6Y2Q4ntetmKuqqK23qvhzqzm21bMre6osr9iMm?cluster=devnet) moved exactly 30,000,000 token units from the QA creator to the reward vault. The public reserve API verified the receipt and exact source/destination deltas. |
| Migrate | [Pump migration](https://explorer.solana.com/tx/3a8or5kDvB7wuDPBcwwjnqqNjTXA8g86ijSFe9BoojMuxYYM6wKjWQnQrsUG4ocd9uPG7xcc1Z4cbNWEGbEX2eCf?cluster=devnet) finalized at slot `505975392`. The canonical PumpSwap pool had the expected owner and positive reserves. |
| Capture and open | The worker persisted a complete, immutable exact-slot `$FUNDED` snapshot and Merkle manifest for four eligible wallets. [Opening](https://explorer.solana.com/tx/46yo1umgDnzkw7KTrADRVgANMEqvVSsPbUeTDrKkGPSKMXNBvxSvRSo48Q1rnveBESEuPjPPNuq9eiv8gHmAxSBW?cluster=devnet) moved all 30,000,000 tokens from RewardVault to CommunityDrop `CRRaMRKxThkTUUMj9DrshBxDWbcVRdTgWj9ubbMnXTm7`. The on-chain receipt, PDA, root, snapshot hash, slot, and exact vault deltas were verified. |
| Wallet claim | The rotated QA creator's verified leaf allocated `42,353,538` token base units. [Claim](https://explorer.solana.com/tx/5Z4W5iyRwpThaobwVePxcEaRVSVru6XCV2EEDrRiDbBzPswRHsLe6srbCJnVKWiEEUeuuyE2x9szCZ4eQi9kKbm1?cluster=devnet) finalized; its token account rose by exactly that amount, its payment PDA was created, the public proof status changed to `claimed`, and a repeat claim-instruction request returned HTTP 422. |

The first QA token created during this rollout, `EjTB5RYfcg5YkKSY1ierJ8wsSnAidVJERqsR4xGYe9S4`, also launched, funded its reserve, and migrated. Its opening did not proceed because an unrelated transaction in the replay blocks used transaction version 1 while the RPC request allowed only version 0. The block reader now allows version 1; the successful second mint above verified that fix. That first mint is outside the 256-slot replay bound and remains funded without a drop. It needs an independently verified archival snapshot if its test reserve is ever to be distributed; no approximate holder list was substituted.

The second rollout exposed a two-base-unit pro-rata rounding remainder (`29,999,999,999,998` allocated from `30,000,000,000,000`). The opening preflight now verifies `0 < allocated <= total` and `remainder = total - allocated`; the on-chain drop holds the whole reserve, and the remainder stays for the configured expiry route. A focused test covers this class of case. This was a JS preflight fix; the reviewed on-chain binary did not change.

## Remaining gates

- The scheduled coin-holder SOL payout for prior fresh mints remains below its 10,000,000-lamport minimum and has a 2026-10-02 UTC cutoff. An earlier isolated Devnet holder payout verified the chain adapter, not that scheduled distribution.
- Live X reward needs a consenting OAuth-linked QA X account and a new launch with an X allocation. Paid listing and Boost each require 25,000 Devnet `$FUNDED` in a QA wallet; the rotated QA wallets do not hold that balance. These flows were not fabricated or claimed as passed.
- A post-upgrade read-only reward-program check passed. An optional additional SOL/token payout regression run hit RPC WebSocket HTTP 429 before it returned finalized evidence and was stopped without retries. Its result is unavailable; prior Devnet payout evidence predates this upgrade.
- Runtime API checks used the healthy local app port behind the Devnet tunnel. A direct `https://funded.vip/api/health` request from this host failed at TLS setup, so independent external HTTPS reachability and Phantom UI signing were not verified in this run.
- Mainnet deployment, transaction testing, security review, and production operations remain unverified.
