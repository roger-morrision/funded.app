# FQA-MN-003: configurable-router compatibility map

Reviewer-ready source/interface map, 22 November 2026. **No runtime change or integration acceptance.**
FQA-MN-001-A/B and the bounded offline model were independently accepted locally at `aa848f70`;
the parent holder-scale issue remains open. This document addresses only MN-003's mapping slice.

## Frozen contexts and identity domains

| Context | Exact source revision | Meaning |
| --- | --- | --- |
| A: application checkout / retained funded.vip build | `e06d2de0338e15a3e06ef9861b8540eeb934c84a` | Devnet application profile; unrelated dirty owner files preserved. |
| Separate retained richpad.fun build | `d5cf43d6c926f8945e1ed06e1d89019e0f432366` | Existing non-program Mainnet profile, not the isolated router. |
| R: protected contract/readiness branch | `ff2aac18e10612211f9d78817a7316ab504ac999` | Candidate contract source and ahead-of-main application helpers; not a public app deployment. |
| Accepted offline model / map parent | `aa848f70b44d8d1168299062d7fbe6a40aa97be9` | Holder planner/journal prototype, not imported into the live scheduler. |

`A:` and `R:` links below pin the full Git revision and line, not the moving branch.
Raw evidence and exact blob snapshots: `data/qa-evidence/router-compatibility-map-20261122/`.
The map reads committed blobs; neither dirty application documents nor private deployment secrets
were used as runtime evidence. Public build identities reuse the previous read-only observation
in `data/qa-evidence/holder-paging-20261122/public-build-identities.json`; no new HTTP/RPC calls.

| Identity or hash | Manifest/record value | Domain and limitation |
| --- | --- | --- |
| Devnet genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | Network identity, checked by `assertRpcNetwork`; a cluster string alone is insufficient. |
| Isolated configurable program | `9E7wuzUbNLpauYH5BR6qPmg6mjb5qsZJW96zjLJELfCf` | Executable program address; not the public app's approved program. |
| Recorded ProgramData address | `4ej89f84gD5MD9uoyUWLDWXqAw68yByBwJcyYSiTecf8` | Upgradeable-loader data account, not the program address. |
| Recorded complete ProgramData SHA-256 | `bbf6b99857a9464c23d000caf7fa5cb5f19af7b2ce8ff402c2e9c37c8d68f688` | Entire account bytes, including loader header/slot/authority and any allocated padding. |
| Configurable ELF SHA-256 / length | `7b4b6bab3605135fb251894ca558f425f8bdc4c42e0de46ebfb00e135247c25f` / 1204336 bytes | Executable bytes; not interchangeable with full ProgramData hash or Git revision. |
| Recorded upgrade authority | `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y` | Public identity from the retained Devnet record, not signing authority granted to this job. |
| Recorded primary RICH config | revision `2`, mint `8FmsUFC9aPepfDtQ6ffM2eTbDBzCWTypRLvZbx65Nvex`, market `9q91H5TaaP4HpPCWNtAy1umf5wR9zM8EXc5nnaUAaqQC` | State at retained record time `2026-11-22T07:01:20.219Z`; not a fresh chain read. |
| Old app approved binary | `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`, ELF `c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15` | Separate runtime commitment; its receipts/allowlist cannot satisfy isolated-program acceptance. |

Sources: [R:config/contract-build-candidates.json:43](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/config/contract-build-candidates.json#L43),
[R:docs/evidence/devnet-configurable-rich-2026-11-22.json:13](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/docs/evidence/devnet-configurable-rich-2026-11-22.json#L13),
[A:server/agency-release.mjs:9](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/agency-release.mjs#L9),
[A:solana-network.js:9](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/solana-network.js#L9).
`readProgramDataEvidence` hashes all ProgramData bytes; `matchesAgencyBinary` hashes the ELF
slice after the 45-byte loader header and requires zero padding:
[A:server/program-data-evidence.mjs:44](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/program-data-evidence.mjs#L44),
[A:server/agency-release.mjs:12](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/agency-release.mjs#L12).
The expected local configurable ELF path was absent during this mapping pass. The hashes above
are current-manifest / retained-evidence declarations, **not** a new binary rebuild or chain-byte
verification. The candidate manifest does not bind an exact build source revision; Git source
hashes in the companion evidence do not repair that missing provenance. Production identity,
source/binary/ProgramData and independent-review fields remain null in
[R:config/mainnet-program-release.json:4](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/config/mainnet-program-release.json#L4).

## Interface compatibility and concrete gaps

| Boundary | A: existing app/public source | R: isolated/configurable source or requirement | Consequence / smallest necessary follow-up |
| --- | --- | --- | --- |
| Browser primary asset | Build-time `VITE_FUNDED_TOKEN_MINT` / swap pool in [A:src/app/startup/connections.js:337](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/src/app/startup/connections.js#L337) | `loadPrimaryRichForApp` validates `/api/token-config`, program, revision and `onchain-v1`; fails closed on unavailable config: [R:src/app/startup/primary-rich.js:3](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/src/app/startup/primary-rich.js#L3) | The helper is absent at A. Preserve old completed receipts; new actions need a frozen active revision, not a build-time mint fallback. R helper currently runs only for reviewed Mainnet, not isolated configured Devnet. |
| Server asset / quote snapshot | Paid-tier quote uses `fundedTokenMint`, network and service-fee hash; [A:server/routes/launch-quotes.mjs:63](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/routes/launch-quotes.mjs#L63) | `createPrimaryRichReader` reads finalized active assets; tier quotes add `richAssetsRevision`, mint, market, slot and expiry: [R:server/primary-rich.mjs:8](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/primary-rich.mjs#L8), [R:server/routes/launch-quotes.mjs:65](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/routes/launch-quotes.mjs#L65) | A lacks this reader/revision field. R still chooses environment assets on Devnet. Distinguish asset revision from service-fee `revision`/`policyHash` and agency rules `configRevision`. |
| Configuration / administrator ABI | `rich-assets.js` is absent at A. | [R:rich-assets.js:12](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/rich-assets.js#L12) expects 177 bytes: mint, pool, token program, u64 revision, venue, authority and pendingAuthority. [R:rich-assets.js:30](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/rich-assets.js#L30) supplies owner signer, program/ProgramData, active and immutable history PDAs. [R:rich-assets.js:40](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/rich-assets.js#L40) / `buildAcceptRichAuthority` use a current-authority proposal and nominated-successor acceptance. Contract [R:contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rich_assets.rs:81](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rich_assets.rs#L81) treats a self-proposal as cancellation, while [R:contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rich_assets.rs:91](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rich_assets.rs#L91) requires the pending successor's signature. | Contract [R:contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rich_assets.rs:13](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rich_assets.rs#L13) and `configure` freeze history and increment revision. Current/pending administrator is not the worker, wallet creator or price signer. Keep administration outside hot-signing paths. |
| Generic / agency launch and fee categories | `buildProtectedMintRouterV3InitializeInstruction`, settlement and protected disbursement use explicit authority/creator flags and per-mint PDAs: [A:mint-router-v3.js:166](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/mint-router-v3.js#L166), [A:mint-router-v3.js:270](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/mint-router-v3.js#L270) | Agency policy is eight categories, immutable policy revision and selected agents: [R:agency-mint-router-v3.js:73](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/agency-mint-router-v3.js#L73). Protected reward creation changes router mutability, and Mainnet payout adds router account: [R:server/automatic-reward-chain.mjs:364](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/automatic-reward-chain.mjs#L364) | Review ordered account metas per instruction, including writable flags and creator versus authority signatures; seven-category normal and eight-category agency ledgers cannot be interchanged. Never infer ABI compatibility just from a shared method name. |
| Launch admission / program bytes | `createV3LaunchConfig` still compares approved hashes and readiness to existing Devnet release; agency release requires the old program ID and ELF: [A:server/v3-launch-config.mjs:17](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/v3-launch-config.mjs#L17), [A:server/agency-release.mjs:19](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/agency-release.mjs#L19) | Configurable manifest explicitly states client and signer remain on the prior program. | An environment program-ID replacement is insufficient. Exact release-specific identity, header/authority, lookup tables, agency heartbeat and signer context need a reviewed isolated profile. No admission change here. |
| Buyback asset / instruction bytes | A `buybackAssets` fixes Devnet mint/pool and builder emits legacy 64-byte normal / 122-byte agency instructions: [A:server/buyback-assets.mjs:10](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/buyback-assets.mjs#L10), [A:server/v3-buyback-instruction.mjs:105](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/v3-buyback-instruction.mjs#L105) | Contract exposes `buyback_configured_mint_v3` with trailing u64 `assets_revision`, and configured agency equivalent: [R:contracts/funded-fee-router/programs/funded-fee-router/src/lib.rs:209](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/lib.rs#L209). R builder appends revision/config account **only when cluster is Mainnet**: [R:server/v3-buyback-instruction.mjs:108](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/v3-buyback-instruction.mjs#L108) | Both actual cluster and reviewed ABI capability must be represented; do not spoof Mainnet to exercise configured Devnet. Old and configured normal lengths are 64/72; agency lengths 122/130. |
| Quote/config binding and historical proof | A decoder accepts only old discriminators: [A:server/price-signer-review.mjs:20](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/price-signer-review.mjs#L20) | R decoder supports configured bytes, but reviewer requires `args.configured === (network.cluster === mainnet-beta)`: [R:server/price-signer-review.mjs:89](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/price-signer-review.mjs#L89). R finalized proof loads immutable history at decoded revision: [R:server/v3-buyback-proof.mjs:48](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/v3-buyback-proof.mjs#L48) | Static compatibility blocker: configured Devnet requests cannot pass R review as written. The local pure decoder probe independently shows A rejecting the same 72 bytes R decodes as revision2; full price review/signing was not exercised. Requote on active revision changes; use historical revision for old finalized receipts. |
| Worker signer | Role handles send `role/version/message`; remote service signs the exact message after policy and durable journal: [A:server/remote-signer.mjs:36](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/remote-signer.mjs#L36), [A:server/signer-service.mjs:78](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/signer-service.mjs#L78) | R additionally denies rich-asset configure/propose/accept and covers explicit extra-router allowlists: [R:server/signer-policy.mjs:18](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/signer-policy.mjs#L18), [R:server/signer-policy.mjs:73](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/signer-policy.mjs#L73) | A lacks those new denies. Do not add isolated program to any hot-signer allowlist before exact policy review. Message digest/program allowlisting is not independent ELF provenance; preserve loader/authority-change denials and the fail-closed journal. |
| Price signer / message metas | A verifier reconstructs exact account order and flags; authority and independent signer are positions0/1 of the v0 message; price signer occupies router-meta17: [A:server/price-signer-review.mjs:66](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/price-signer-review.mjs#L66), [A:server/price-signer-review.mjs:139](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/price-signer-review.mjs#L139) | R configured metas add final readonly rich-assets PDA and make router writable only on Mainnet: [R:server/price-signer-review.mjs:152](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/price-signer-review.mjs#L152). Boot/service stay Devnet-only and verify public program identities/hash before key load: [R:server/price-signer-bootstrap.mjs:17](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/price-signer-bootstrap.mjs#L17), [R:server/price-signer-service.mjs:8](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/price-signer-service.mjs#L8) | Compare full serialized message and decompiled signer/writable flags, lookup tables, independent quote/minimum/max debit, fresh slot/time/blockhash and active revision. A configured message must not inherit admission merely because the decoder understands it. |
| Price-signer transport | [A:server/buyback-price-signer.mjs:34](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/buyback-price-signer.mjs#L34) requests Devnet/program/transaction and verifies the returned base64 signature. Remote role signer returns base58 instead. | [R:server/price-review-network.mjs:7](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/server/price-review-network.mjs#L7) binds request network/program and reviewed Mainnet manifest for review-only code. | Keep the two signature encodings, credentials, authority roles and service journals separate. Neither service is authorized for Mainnet by this map. |
| Price / agency / community journals | Price reservations persist messageHash, program, vault, receipt, blockhash, quote/minimum/slot before signing: [A:server/price-signer-journal.mjs:51](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/price-signer-journal.mjs#L51). Agency persists immutable intent/evidence hashes and signed bytes before send: [A:server/agency-execution-journal.mjs:107](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/agency-execution-journal.mjs#L107). Community likewise checks intent: [A:server/community-execution-journal.mjs:31](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/community-execution-journal.mjs#L31) | Unknown signatures retain budget; `unusedPriceReservation` needs finalized expiry and absent receipt evidence: [A:server/price-signer-reconciliation.mjs:5](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/price-signer-reconciliation.mjs#L5). | Existing reservations do not explicitly store every genesis/ELF/source/config field. Define a versioned immutable context for new isolated records; message hash commits encoded revision but is not a substitute for explicit provenance. Never rewrite old intents to another program. Timeout/absent recent history is not permission to resubmit. |
| Worker wiring | Holder worker consumes `FUNDED_V3_FEE_ROUTER_PROGRAM_ID` / full hash and finalized indexer: [A:server/background-maintenance.mjs:60](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/background-maintenance.mjs#L60). Generic buyback worker calls internal status/automation APIs: [A:scripts/run-v3-buyback-worker.mjs:30](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/scripts/run-v3-buyback-worker.mjs#L30). Agency config pins program/hash/build: [A:scripts/run-agency-buyback-worker.mjs:12](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/scripts/run-agency-buyback-worker.mjs#L12) | Agency run intent binds mint, program, approvedHash and policy: [A:server/agency-buyback-executor.mjs:35](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/agency-buyback-executor.mjs#L35) | An isolated profile must bind API server, direct-RPC worker, signer, price reviewer and ledger context together. Do not create a second worker sharing the live authority/ledger, reactivate X, or replay old-program actions. |
| Existing public Mainnet | Non-program write allowlist is explicit: [A:server/network-write-policy.mjs:14](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/network-write-policy.mjs#L14) | Full-program production manifest remains unapproved. | Existing trading/listing/boost/referral traffic and old-router receipts do not establish configurable launch, fee, reward, buyback or migration acceptance. Preserve current mutation policy. |

## Reward leaf, bitmap and authoritative replay boundary

- Global reward identity: [A:reward-merkle.js:42](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/reward-merkle.js#L42) hashes mint,
  kind, asset and period. [A:reward-merkle.js:33](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/reward-merkle.js#L33) commits domain,
  cycleId, recipient, asset mint, u64 amount and **global u32 index**; sorted-pair proofs preserve
  the existing domain. Neither root nor cycleId explicitly includes genesis, program or ELF.
  Program-derived cycle/payment PDAs provide a separate address context, which the journal and
  evidence adapter must bind explicitly. Never replace an existing root/order after rotation.
- Contract global-index and proof checks: [R:contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward.rs:288](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward.rs#L288)
  and [R:contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward_bitmap.rs:153](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward_bitmap.rs#L153) require positive amount,
  `leaf_index < leaf_count`, proof length at most32, immutable root, payout/expiry and solvency.
  Bitmap uses `index/8` and `index%8` on the same cycle, not page-local indexes.
- Capacity: [R:contracts/funded-fee-router/programs/funded-fee-router/src/reward_bitmap_state.rs:20](https://github.com/roger-morrision/funded.app/blob/ff2aac18e10612211f9d78817a7316ab504ac999/contracts/funded-fee-router/programs/funded-fee-router/src/reward_bitmap_state.rs#L20) is65,536 per cycle;
  [A:server/reward-rent.mjs:4](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/reward-rent.mjs#L4) agrees. A 32-leaf planner page
  is an off-chain work unit, not a new on-chain shard or 32-recipient transaction. Existing
  [A:server/reward-batch.mjs:4](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/reward-batch.mjs#L4) bounds Devnet submissions to
  four recipients,1200 serialized bytes,600,000CU and may split further. Mainnet takes the
  existing non-bitmap path; no production bitmap capability is implied.
- Authoritative lookup starts with full network/program/ProgramData/authority readiness in
  [A:server/automatic-reward-chain.mjs:153](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/automatic-reward-chain.mjs#L153). The Devnet
  `financialProgramAllowed` branch alone returns true; the following byte/hash/header checks
  still matter and do not constitute a new isolated release allowlist.
- [A:server/automatic-reward-chain.mjs:286](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/automatic-reward-chain.mjs#L286) verifies the full
  frozen cycle and either exact RewardPayment fields or bitmap membership. A set bit proves
  consumed entitlement, **not independently observed recipient credit**. The adapter also needs
  [A:server/reward-payout-evidence.mjs:9](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/reward-payout-evidence.mjs#L9) and
  [A:server/reward-batch-proof.mjs:3](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/reward-batch-proof.mjs#L3) to prove exact
  program instruction/leaf, successful finalized transaction, payer, vault debit and recipient
  SOL/token delta. Legacy closed receipts require retained immutable signatures and archive proof.
- [A:server/reward-payout-evidence.mjs:46](https://github.com/roger-morrision/funded.app/blob/e06d2de0338e15a3e06ef9861b8540eeb934c84a/server/reward-payout-evidence.mjs#L46) tries a
  preferred signature then at most3 pages of100 finalized signatures. Exhaustion is explicitly
  unavailable evidence, not proof of nonpayment or permission to resend. A1,001-leaf cycle can
  outgrow a shallow scan; retain per-batch/per-leaf signatures in the new context.
- The accepted offline journal's11 receipt facts are mocked inputs. An authenticated adapter
  must produce them from exact-program finalized evidence and distinguish allocated versus
  actually received token units/extensions. No adapter is implemented by this map. Parent
  MN001 keeps production cap1000 and larger-cohort delivery/storage/throughput open.

## Smallest proposed isolated integration test slice

Propose **one configured-Devnet buyback message path** first, not public activation or all flows:
use two immutable primary-asset revisions and one source mint, with local deterministic public
fixtures and unsigned messages. Connect builder -> exact-message price reviewer -> reservation
journal -> finalized-proof parser in an isolated harness. Pin the Contract owner's accepted ABI
and exact configurable artifact/context first; do not select configured ABI by pretending the
network is Mainnet or altering any live allowlist.

Measurable acceptance for that next source/test slice:

1. Configured normal72-byte and agency130-byte encodings, trailing revision and final config PDA
   match the pinned contract signatures and exact signer/writable meta order. Old64/122-byte
   messages cannot silently enter the new configured path. Mainnet remains rejected.
2. Identical current-revision message reviews deterministically; wrong genesis/program/full hash,
   stale active revision, changed mint/venue/token program, price signer, quote minimum/debit,
   account flags, expired blockhash or unsafe admin instruction each produces zero signatures.
   Completed old-revision evidence uses immutable revision history, not current mint substitution.
3. Interrupted reservation/message replay preserves the exact message and budget; no signature
   timeout or absent recent scan frees a second spend. Distinguish mocked state from actual finality.
4. A compiled-SBF fixture subsequently binds those same bytes to the reviewed artifact, tests
   old/new entitlement separation and no duplicate effect. If the exact artifact is unavailable,
   label this unavailable; do not substitute old public-program receipts.

The later reward-adapter slice uses global indexes0/31/32/1000 across the same root, SOL and
paired-token deltas, restart/partial/duplicate/finalized replay, and explicit65,536/65,537 bitmap
admission. These remain planned cases, not results of this mapping pass. Real Devnet canaries
require their existing exact fixture authority/budget; none are requested or executed here.

## Contract-owner questions for the existing shared matrix

Return answers through `roadmap.json.mainnetReadiness.contractCoordination` / existing evidence,
not a second queue or unapproved direct message:

1. Freeze supported tuple: genesis, program, ProgramData address/full hash, upgrade authority,
   exact ELF bytes/hash, reproducible build source/toolchain/features, and accepted config revision.
   Does the recorded07:01 configuration still describe the intended isolated target?
2. Confirm a reviewed configured-Devnet ABI capability independent of network strings; exact
   normal/agency discriminator/length, remaining config account position/flags, router writable
   rules, pause/solvency accounts and full signer policy. Which ordinary launch/settlement/reward
   metas differ from the deployed old program? The observed Mainnet-only branches are not a plan
   to weaken either network or financial policy.
3. Confirm active versus immutable history semantics for queued quotes, old/new mint entitlements,
   proposal/acceptance across rotation, token program/extensions and category6 RICH/category7
   own-coin burns; keep service-fee, RICH asset and agency rule revision domains separate.
4. Confirm per-cycle65,536 bitmap capacity, global u32 indexes/proof<=32, SOL/token layouts,
   terminal expiry/cancellation/cleanup behavior and supported future sharding scheme. No
   off-chain page index may reset a global leaf index or reuse a consumed receipt.
5. Specify authoritative finalized payment/replay evidence, archive retention beyond300 signature
   scans, unknown-attempt reconciliation and required exact recipient/vault/reserve/token deltas.
   Define explicit immutable context fields and migration handling for existing journals.

## Outcome

Mapping complete; runtime integration, financial testing and independent full-program acceptance
remain open. No source module, cap, signer allowlist, deployment, policy, wallet or financial
operation changed. No broad UI suite was repeated for this documentation-only slice. The only
new executable observation is the local pure decoder boundary probe; its first launch used an
incorrect argument offset and failed before imports, then the corrected harness passed. Both
logs are retained. **Full-program Mainnet remains NO-GO.**
