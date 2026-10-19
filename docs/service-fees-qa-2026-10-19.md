# Service fee QA — 19 October 2026

**Historical rate notice:** the trade receipts in this report were executed at the earlier 0.75% rate. The user subsequently corrected trading to **0.5% on both buys and sells**. These earlier receipts retain their actual rates and do not prove collection at the corrected rate. See [current fees](app-service-fees.md) for the active schedule.

## Release and scope

- Initial implementation: `fe9b144a15ff0f854e5bd0167cb87abe61b4d04f`.
- Payment/persistence correction: `90f48462eadcfa17292ba54c563a4c67569acc37`.
- This report's commit adds the final home program-picker copy correction. Its financial implementation is unchanged from `90f4846`; the picker now uses the current admin policy after switching views.
- Cluster: Solana Devnet. These results do not authorize or verify mainnet use.
- Live approved service-fee revision: **1**. Policy hash: `b0d03d089759e562970d40391ee816764933343616410fc07b89908196e9f2c4`.
- A real signed allowlisted QA administrator session saved the approved policy to PostgreSQL. Revision/hash conflict checks and the admin form were also tested locally.

## Finalized payment evidence

Each SOL fee below was checked against the exact treasury balance change in its finalized transaction. Each burn was checked by registration and token-supply evidence. USD prices determine the quoted token quantity; USD is not transferred on-chain.

| Flow | Approved fee | Observed evidence |
| --- | --- | --- |
| Curve buy | 0.75% | [75,000 lamports credited](https://explorer.solana.com/tx/5gmwf9LWmdW4V4daTugkUvK11UQXitNpFtnASR3yhR44iV7ancHAxYeYDEmaMzUBi2Pr5anHxMxb783d1FD4bmLE?cluster=devnet) |
| Curve sell | 0.75% | [37,338 lamports credited](https://explorer.solana.com/tx/3JnizJT5dFoNCbv6Pj2PfpRkcaZbFUhQxKrCWVs13LFK1RDrtbgFhZspb7eixSULZzMNjmuHcRLvASFR1BmbBqjJ?cluster=devnet) |
| PumpSwap pool buy | 0.75% | [60,000,000 lamports credited](https://explorer.solana.com/tx/5XHcGRm6FHd6fACTCf7Z4KkpKDNFKWeLFX8Vb5uQDHHjg1xGXz9GdKkhtCoTnZixv3kEF1iGu8WugPa8nsiiAPFi?cluster=devnet) |
| PumpSwap pool sell | 0.75% | [58,062 lamports credited](https://explorer.solana.com/tx/5DpX2RvqGUen4cfqEg7GFHbZXKUfv7UUvu81sPvgoatyjK3PiVrVPoqBNtJCRraDeEdy5hxjuhtEbtTan7SzErbs?cluster=devnet) |
| Standard launch | 0.02 SOL | [Atomic fee and reserve](https://explorer.solana.com/tx/dBBFfuhahWZ5LUCy1AH1EX8ytx5g9netSbMtBUWu5P1t6h4e8oq4E5EVik2tG1u1hovJKakk4LmGdbBFg25XWtU?cluster=devnet) |
| Pro launch | 0.02 SOL + $150 FUNDED burn | [Atomic fee, reserve and 183-token burn](https://explorer.solana.com/tx/5ApxKq77TLxFE3Bkv2kDZFCxCNg6jkDn9RomF64xVPnyZexYdNWoBysatHqbtMk9tXDw1ByBxJMKms7yndNwHZ17?cluster=devnet) |
| Premier launch | 0.02 SOL + $300 FUNDED burn | [Atomic fee, reserve and 366-token burn](https://explorer.solana.com/tx/Dp1LXSikkjKrkFDTFTLxSGfPi17qGyLjV6LFvHVvQ8Cj3fH2UgsC5bNcbzqSGQCi7nwq6WwDFFFN8srGQLugPVc?cluster=devnet) |
| External listing | $300 FUNDED burn | [365.268958 tokens burned and listing registered](https://explorer.solana.com/tx/3bQ82qKcLuybyboAvqQF16966qBAfD3MpoB7scMoyoq5GqHFs8WWawjuu11dx6bgWZj1a7bojjGPgRQYu18kNWRi?cluster=devnet) |
| Listing funded.vip-created coins | Included | All three verified launches rejected a second listing quote with `409` and `included:true`; no second listing payment occurred. |

All three launches retain their service receipts in the public launch registry after independent reads. The external listing retains its mint, burn signature and $300 quote in the listing registry. All eight payment signatures were independently re-read at finalized commitment.

## Bugs fixed during QA

1. The strict V3 readiness hash still referenced an older approved deployment. Fresh ProgramData evidence matched the existing approved recovery artifact; the strict expected hash was aligned. No contract upgrade was made for service fees.
2. Paid launch packets exceeded Solana's limit. The Devnet lookup table was extended with four fixed public accounts, the quote memo compacted, and signing overflow moved inside the existing router-setup fallback. Creation, fee, reserve and promotion burn remain atomic.
3. PostgreSQL did not persist the new service quote bucket. Live Standard creation paid successfully, then registration correctly refused the missing quote. Further payments stopped until the bucket fix and real PostgreSQL reconnect test passed. The exact original creator-signed policy was recovered without another transfer. The quote's issuance interval was reconstructed from its original timestamp-bearing ID, explicitly audited as reconstructed; the original serialized quote was not available. Signature, policy hash, mint, amount, memo and finalized treasury delta were verified before the single quote restoration.
4. The home creator/community picker could restore legacy Pro/Premier prices after a view switch. It now reads the current service-fee policy initially, on refresh, and after each re-render.

## Validation boundaries

- Full archived-source suite at `90f4846`: **949 passed, 10 skipped, 0 failed**. One initial sandbox Git ownership failure passed when rerun as repository owner.
- Corrective production image: **14 affected tests passed**, including real disposable PostgreSQL reconnect, fee quote read-back failure, atomic fee verification and packet splitting.
- **20 browser regressions passed using mocked APIs**. The subsequent picker change passed all four fee-browser tests, including default and changed prices at desktop/mobile sizes and creator/community view switching.
- Production builds passed. The existing large-chunk warning remains.
- Live guest UI was checked on launch, Capital flow, fee docs, listing and a newly registered Pro coin. Mobile pages had no horizontal overflow. A fresh post-deployment launch-page load had no console errors. A transient 502 during container replacement cleared after health checks completed.
- Signed transactions used configured disposable Devnet QA keys through the application SDK and public registration APIs. This does not prove approval through every browser wallet extension. The final admin form interaction was mocked; the signed admin API/persistence check was real.
- QA funding was bounded at 9.5 Devnet SOL with one 8 SOL FUNDED purchase. Unused QA SOL was returned, preserving the creator's original SOL balance and the authority's 3 SOL reserve. No key files or raw signed transaction journals are tracked in Git.
- Pump/pool-native fees and the saved 80/20 creator-fee split are separate from these app service fees. Existing payout/migration flows were not re-executed in this fee-specific run. The proposed AI agency budget/executors remain unactivated.

Ignored local evidence: `data/qa-evidence/service-fees-1792389659451/evidence.json`, `final-audit.json`, the transaction journal, and `tmp/service-fees-*-unit*.log` / browser/build logs. These files contain operational evidence and are excluded from the source commit.
