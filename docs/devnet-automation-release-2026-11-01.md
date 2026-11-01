# Devnet automation deployment and acceptance

The subsequent [RPC gateway release](rpc-gateway.md) supersedes this report's service-image revision while retaining the same finalized program and financial policies. The results below describe the earlier bounded financial acceptance run.

Deployment is complete. Full unattended end-to-end acceptance remains incomplete because of RPC capacity and unexercised eligibility/milestone conditions. This report distinguishes direct contract tests from deployed worker/API evidence.

## Deployed artifacts

- Devnet program: `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`.
- Upgrade authority: `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`.
- Finalized deployment slot: `517313000`.
- Tested binary: 1,051,848 bytes; SHA-256 `b4189944394dceddbf6c9d116957a5f6185d81a7257f377166e80d1a65388e0e`.
- Full finalized ProgramData SHA-256: `f0517fce9b8361be087456be2f5e5547af23b114ca1c0cf4ebaba5a42a8bd9ca`.
- Final service image: `fundedapp-devnet:automation-6e32beb3`.
- Isolated source revision: `6e32beb3c579a7df217efed8711266af749a5d28`, branch `codex/devnet-automation-final-20261101`.
- Image identity / manifest digest: `sha256:7574e52b220304e8df79e0ce14eb6f068560103f19ee72360ab98cb4f46c278e`.
- The parent image was built from the exact clean Git archive at `a31bf38c7ddcd7bf27a37da8ed123ed4f9a66aec`. Subsequent isolated images change only community snapshot/reserve verification modules and their tests. Git-diff guards, exact source-blob checks, parent identity checks before/after each build and inherited layer checks passed. Concurrent page and fee-copy changes are outside this deployment.
- The existing partial buffer was completed through Solana's direct validator transport. Its full payload matched the tested binary before upgrade; every finalized program byte then matched. No second funded buffer was created.

Financial automation gates were enabled after the program hash was verified. Mainnet and browser-held development wallets remain disabled. The API and agency worker have read-only roots; all four services run as the image's non-root `node` user. The collector and buyback worker retain their existing writable temporary runtime.

## Live direct contract integration

Fresh mint: `5atibfgFNrKTCeatBjmMJVtcvKaksmSQCJeN6nGT3pfR`. Disposable participant keys existed only in memory.

The completed sequence includes Pump launch, four buys and a sell, permissionless collection, authority-only fixed-policy settlement, immutable automation enrollment, creator payout, holder/X funding, daily bonus funding, operations payout, one referral payout, a Merkle-proof holder payment and a $FUNDED buyback/burn. Production proof readers verified exact finalized instructions, receipts and balance deltas.

| Evidence | Signature / result |
|---|---|
| Collection | `2cahzSWMCnuD7XCkLJ88xiZYRqZPBbLveC4QAZnqGfAJjS3jGCkzH33FCPHvZBfXv9RVp38STiE4Gezk6DU4Y4d5` |
| Automatic settlement | `5mQ81QPoPFYL8SzYDNVEwWYGKsfV4kv6Eu2Et6Wwx9fa6xVisAmpzC5TyfgGG8nUVLCAN3VYyisa64FSGPg2Tyf9` |
| Holder payment fixture | `2KnkizhgoNmQtznftsFpUDzMiXfcet8i1q2SBqY5ecRcLUgtgWeCFifAmMvgCN7ctPozvuGzDDpdNDvfhxHAbPna`; 244,723 lamports |
| Buyback/burn | `9yrjDg52n1ompSp51rYxwvi3vKV3o9pBAauwjsPZHASzhczrbdjBqip8NB6u8Q8HhfCwhQeiewHCaxnUsdQwCzr`; 122,362 lamports spent; 15,719 $FUNDED base units burned |

The holder manifest and X recipient in this test are fixtures. They do not establish live OAuth identity, elapsed holder eligibility, daily ranking eligibility or automatic milestone execution.

## Deployed app and worker integration

Fresh registered agency mint: `F89G4CZxBvuMqLEN4XbaJ9vVz8cC2tNkieNJmnxoJnVj`.

| Flow | Verified evidence |
|---|---|
| App launch and signed policy registration | Launch `4nxCYzwAkEFqTpYtgNm6mRtyn72eoaxj9Hnwr3HRtZv6vCYxW5aVyZkD8etBe64NhydZwHkR97ow1LXSwnmpChgk` |
| Atomic reserve | 30,000,000 launched tokens in the verified reward vault |
| Atomic launch service fee | Exactly 20,000,000 lamports to the quoted treasury, with matching memo and receipt |
| Real Pump migration | `a7ErzSp5N5UCKjhA2u3cpp43kGuYjubjT96oGHAVG5r7VQ6rpfbhVUDd9WfQjRzLikFmpgwYUM3fMByg5v838Rz` |
| Deployed collector after migration | `5jwbViNDokSVbUamLhcS3EPs9j4ebRy96hcAMVZ2ew9E3Dw9a7T8RwUWFDdb5y8zfftXDhGuBHxQMhFH47ZcBpfL`; 10,124,080 lamports |
| Deployed settlement job | `56vm7WgETbfTUEjQ2A4fj7TD4486Z2y9baPJSbYP4TdTqzK4BNu2uQrsUwGJgtHGE6mjkpUSpcFxzP3jN4GSD5Zo`; authority-fixed-policy, eight categories |
| Creator payout | `5gFC6x7ZtsxFUdnwxKfC4LGJb2CCuM6BTfDDxfE2cwMfjgHAEtxXUUPDK5cNBJdw76QQ4jjGyaaJ6HUqmBMrc9BR`; exactly 7,086,856 lamports |
| Holder funding | `2NmijfpnSrxdQEbtwDjoBEWbXxSykjUhwP6ScKqCGjYwCapjAH24eFjXkA9z6ZM3NHfty4JpfvHZKAoAeWsWDsFa`; exactly 1,012,408 lamports; verified and enrolled |
| Daily bonus/community funding | `4i2A2WyW8eAwM7XB7ZZ5aeEH7yso7XaCEbNoKAucXvXMyg94B2cibqiMGNEPJtnHLn9fz5HbxmUdsB2xiB414AG3`; exactly 404,963 lamports |
| Operations payout | `21HrQg7j95BLrdroArfJ6YTEF8aPpNVBM7L2CVeskL39TSPEpABoShx7yZcwxaowPEcs666UjW1VSEyaUJvYgDo8`; exactly 809,926 lamports |

The collection ran in the deployed background worker. Additional deployed worker jobs were invoked with `--once` to exercise successive stages without waiting for each five-minute polling interval. No repeated creator signature was provided. A creator payout's follow-up proof read was throttled after the transaction finalized. It was reconciled against a finalized pinned account snapshot using the production proof reader; the payment was not resubmitted.

All four API/worker payouts were independently rechecked using their finalized transactions, exact account lists and a single pinned finalized account snapshot. Each passed the production proof reader with `balanceDeltaVerified:true` and `authorization:immutable-mint-automation`. Competing buyback polls were temporarily stopped before the final two payout checks to reduce RPC contention. Their normal service state is restored after scheduled acceptance below.

The new mint was selected for existing Devnet-only five-minute holder/bonus test windows and low minimums. A separate 0.05 SOL trade crossed the ordinary collection minimum; the final collection exceeded 0.01 SOL. The global low buyback trigger is a Devnet QA setting. Final configuration restoration and remaining scheduled results are recorded below after verification.

## Scheduled and API acceptance

The real holder scheduler closed its five-minute QA window at 01:00 UTC and paid both eligible holders: 974,436 lamports (`SkEkayuiWsqWHAXk21bVqWrJ1PygjDPHJd2b9K7inZQWdD2grgiZmuSztzmT89eMibLRcfFUhpnfHxVJxsi6y2M`) and 37,971 lamports (`2WdaMkRXEXbRodMZnjRv1DAo5dBDg4gkYKRfyGckHA3VEizrvCwQQNR3w2GM7rZTrejCeBgP8kGrAVsukDVCFCCX`). Finalized payment receipts and recipient deltas reconcile to 1,012,407 lamports with one lamport remaining. This exercises actual indexed eligibility under the explicit five-minute, $0.01 QA policy; it does not establish a completed standard one-hour period.

Live testing exposed a bonus index bug: automatic settlement instructions were missing from ranking evidence. The release recognizes both automatic settlement discriminators and safely reindexes old coverage checkpoints. Existing trades, source proofs, assignments and paid receipts are retained. An unused empty QA snapshot was replaced through the audited review/reconciliation service; its original revision remains in history. The ordinary bonus worker then paid 67,494 lamports to the rank-one creator, finalized in `4beG8rNtdRe2C5xTwhegZnS2iXBpTbByrDF861QSxL4BRjGe5tVyETR9gt5RjjpvnW9NhMyM8FWWKEdPoDdZwQ9C`. This verifies the five-minute QA ranking/payout path, rather than an elapsed 24-hour production day.

The deployed authenticated buyback endpoint spent exactly 506,204 lamports and burned 64,880 $FUNDED base units in `2w6Rxx2yoXt1WRyYKzbb7hrQJt36Ktkhq2pW1gNUEKwF5hRACcHMGjF9X4ezBtvyofPXbEegBMkbX9NnGnfwipEt`. The production reader verified the finalized vault debit, burn instruction and exact token delta. The endpoint was invoked once while its polling worker was stopped for isolation; this is API execution evidence, not evidence of an unattended normal 5 SOL trigger.

## Community snapshot and claim acceptance

Three airdrop preparation attempts bought real $FUNDED with fresh in-memory wallets but failed before opening a drop. Original attempt journals are retained. Read-only diagnosis proved the reserve contains all 30,000,000 launched tokens and isolated public RPC throttling of repeated `getBlock` reads.

The final source uses an indexed list only to discover account addresses. Mint supply and every holder balance are read together in one finalized bank, with a disabled mint authority and exact full-supply reconciliation required. Partial lists, mutable supply and cross-bank stitching are rejected. Every intervening finalized block is still reverse-replayed to the cutoff. Shared RPC transport now paces block reads at 2.5 seconds separately from ordinary requests. A real diagnostic replay completed successfully across all eight required blocks; no manifest or payment was persisted by that diagnostic.

The deployed diagnostics also exposed v0 parser bugs: the SDK supplies instruction bytes and `accountKeyIndexes`, while the old verifiers expected legacy Base58 text and `accounts`. Current community openings also append a sixteenth agency-policy account. The fixes handle both actual instruction formats and bind that appended account to the exact derived policy address, retaining exact signer/program/mint, memo, source/destination and balance checks. They passed against the actual finalized cutoff, Pump migration and opening receipts. SDK-compiled v0 regressions reject changed identities, wrong policies and incorrect escrow deltas.

The app prepared an immutable 17-recipient manifest with a full reserve of 30,000,000 tokens. Authority approval and opening finalized in `3cFTPiQwyqPKJC1by66UAZjgQou9DVah3SWhKT2J8Z9AwSGdQAgVasbgCjkc4Kd2fy8GcnJkEdjgzGUcLVsxkuba`. Its first follow-up proof read rejected the current instruction format. The existing transaction was subsequently verified and recorded through the app; the drop was not reopened and its reserve was not transferred again.

One sponsored claim then finalized in `2bcoCPGvZeL9ckLXVQE8eD6Qk83dCMsYh9JjP6sVthq4Lq23yNDfcEZofGFBZaD2sGB624S3tdQJY55YCkEiZKME`. The immutable test recipient `8cZRytZMFaeuBqEyNtcFA1mhtb3j16QcoGRJ7QVuYaHx` received exactly 38,305 token base units. The API's Merkle proof was verified, the fee payer was changed to the dedicated Devnet sponsor allowed by the existing contract, and the recipient/destination/allocation remained fixed. The finalized payment PDA `4ahvbubJ2y6hF1DC4zBQTjZ2AvisiPhHC5XVRyh94cTS`, exact recipient token delta and API `claimed` state all matched. No ephemeral recipient key was recovered or persisted. This is sponsored-claim evidence; a recipient-paid UI signature was not exercised.

This uses an explicitly authorized Devnet QA cutoff after the real migration. It does not establish the original migration-slot snapshot, which was outside the bounded replay window by this later test.

## Final runtime and standard-policy restoration

At 01:42 UTC on November 1, all four named services were running the final image/revision and pinned full ProgramData hash. The API and collector Docker health checks were healthy. The two buyback workers have no Docker health checks; their running processes alone do not establish financial readiness. `https://funded.vip/api/health` returned 200, and `/api/status` returned the final build with storage/network `operational`. Its asynchronous all-collections settlement evidence was still `verification-pending`; the independent finalized settlement/payout proofs above are separate evidence.

The persisted deployment environment and all four service environments have QA minimums, short reward periods and QA community cutoff preparation disabled, with all temporary mint selectors cleared. The bonus period is 86,400 seconds and the ordinary $FUNDED buyback trigger is 5,000,000,000 lamports. The holder ledger now records `periodSeconds:3600`, `eligibilityPolicy:usd-20-hourly-v1` and `qaMinimums:null` for the test mint. Completed QA schedules and receipts remain in history. Financial automation gates remain active. X publishing remains paused.

The collector completed a resumed cycle with one mint checked, zero pending settlements and no settlement errors. The agency buyback loop remained alive but its latest readiness heartbeat was blocked. A read-only diagnostic reproduced HTTP 429 connection limits; a separate paced deployment/router-authority check passed against config revision 4 and the exact authority/hash. No milestone trade was submitted. The full unattended agency path therefore remains unverified under current provider capacity.

## Remaining verification and infrastructure

All four distinct configured Helius keys returned HTTP 429 at the latest recorded provider probe. Solana's public endpoint permits the confirmed transactions and bounded reads above but intermittently returns connection limits and per-method limits. The documented OnFinality public endpoint returned 429; dRPC reported that Devnet requires a paid plan. A successful individual probe does not establish sustained worker capacity.

The $100k/$300k own-coin agents, standard full-hour/full-day schedules, OAuth-bound X payments and 90-day expiry sweep require their own live acceptance evidence. The test coin did not reach those market-cap milestones. Local positive/guard fixtures do not establish those live conditions. No X post was sent by this test.

Local focused route, proof, recovery, RPC-budget, community snapshot, daily bonus and holder-boundary suites passed. The final focused community/RPC suite passed 24 checks, including shared block-method pacing and SDK-compiled v0 receipts with current policy binding. The unchanged SBF candidate had previously passed all 29 Devnet-feature contract tests; the current live tests verified deployed state and payments against that exact binary.

Public receipts and ignored operational evidence are retained under `tmp/automation-release/`. Compose files there contain private environment configuration and must not be published. Old Devnet app records and their authorized backup deletion remain complete; the new tests did not restore them.
