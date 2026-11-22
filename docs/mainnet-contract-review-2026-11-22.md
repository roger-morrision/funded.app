# Mainnet contract security review — 22 November 2026

**Decision: NO-GO for production deployment.** This is an implementation security review by Codex, including review of its own patches. It is not an independent third-party audit, certification, or a claim that every vulnerability has been found. The user's supplied mint is approved for testing only.

**Later Devnet update:** An isolated configurable router was deployed and exercised on Devnet. Its finalized transactions, byte-for-byte verification, and test limits are recorded in [Devnet lifecycle evidence](evidence/devnet-configurable-rich-2026-11-22.json). The binary table below records the builds from this review; current candidate hashes are in `config/contract-build-candidates.json`. The application remains on its earlier Devnet program. The production decision above is unchanged.

## Scope and release identity

Base source for this update: `d297a78cca667f9f3ae6f51cbe8f22748d298cb5`, plus the changes in the commit containing this report. The intended release is the merged `mainnet-v3-program` router, including developer escrow. A separate legacy router/escrow deployment is not required by the current deployment plan.

| Candidate | Bytes | SHA-256 |
| --- | ---: | --- |
| Mainnet-feature public fixture | 1,075,328 | `b619ab3162d476d6cc42f916f06c2c09927942d787c1fef53f0c3756f6284e52` |
| Optional configurable Devnet candidate | 1,204,336 | `113881a532214b5649b3c5088b3549cc6e4d03d828680f5cc1e1b6bb6aa5097f` |
| Legacy-ABI Devnet candidate | 1,168,216 | `7bbf17a0cb16f6fe00d6fac1c38e050ecc3d2897d9aaa3713db9d7af4df37365` |

None of these candidates is approved for deployment. `config/contract-build-candidates.json` records build evidence separately from runtime trust. The deployed Devnet commitment remains unchanged. The production manifest remains incomplete and disabled.

The existing deployed Devnet runtime commitment remains `c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15`, 1,168,496 bytes. No candidate is added to runtime trust.

Build tools: Agave 4.1.2 distribution, whose compiler reports `cargo-build-sbf 4.1.0`; platform tools v1.54; SBF v0; locked Cargo dependencies; size optimization `z`; stripped output. Host tests use Rust 1.97.1 and Node 24.22.3. The Mainnet-feature binary was recompiled from a second source directory and matched byte for byte; dependency caches were reused. This is local reproducibility evidence, not an independent verified build service.

## Findings and changes

| Finding | Severity | Resolution and evidence |
| --- | --- | --- |
| Mature SOL/token reward payouts did not consult the global pause. | High | Payouts now require the canonical router guard as a trailing account and reject a paused guard. Compiled-bytecode tests verify rejected transfers leave custody, reserves, recipients and receipts unchanged. |
| A shared daily cap could delay funded user entitlements. | Policy correction requested by user | Reward commitments and user payouts are exempt. Tests pay queued cycles on the same day above the administrative cap while retaining pause, reserve solvency and replay protection. Operations, promotions and buybacks remain capped. |
| Primary RICH addresses were compiled into the binary. | Enhancement | Owner-controlled, validated, versioned on-chain configuration replaces embedded assets. Immutable history supports old receipts; stale signed revisions and old buyback entrypoints are rejected. See [configuration runbook](primary-rich-configuration.md). |
| RICH changes depended on the program upgrade authority forever. | Enhancement / administration | Revision 1 is bootstrapped by the upgrade owner; subsequent mint updates use a separate RICH administrator. Two-step transfer, cancellation, stale authority rejection and continued configuration after code immutability pass against both compiled network variants. |
| Pre-funded paired-conversion WSOL and community drop accounts could reject legitimate work or misstate credited output. | Medium (availability/accounting) | Conversion subtracts preexisting WSOL and repays only rent actually spent; community drop credits the exact transfer delta while preserving unrelated tokens for closeout. Community donation regression passes in compiled SBF. Clean and pre-funded WSOL conversions now pass isolated compiled-SBF tests against captured public PumpSwap bytecode; live Devnet execution remains unverified. |
| Public token/WSOL donations and pre-funded volume PDAs could permanently block buybacks. | Medium (availability) | Delta-based burns preserve existing tokens. Idempotent WSOL setup refunds actual operator rent; donated native SOL returns to the category vault and is excluded from purchase accounting. Volume PDAs initialize when pre-funded but system-owned. New regressions fail against the previous binary and pass for both policies and both venues; the finalized receipt verifier validates quote-account closure and adjusted spend. |
| Both protected/agency buybacks and agency promotion billing omitted global SOL accounting. | High | Both buyback venues now account for the actual spent lamports within the same atomic transaction; promotion billing accounts before transfer. The promotion test exercises pause, writable guard, replay, daily limit and rollback. Protected and agency category-6 buybacks now execute real captured PumpSwap and Pump bytecode locally; spent/burned deltas, slippage rollback and replay pass. Live financial acceptance remains incomplete. |
| Signer health stayed healthy after a journal failure had disabled signing. | Medium | Health returns 503 after the journal failure latch. Tests verify no signature is returned, later requests stay disabled, and health reflects the fault. |
| Community manifest hashing overflowed the JavaScript call stack for large holder sets. | Medium (airdrop availability) | The snapshot digest now streams the same bytes instead of spreading two buffers per holder into one call. A 70,000-holder manifest and edge Merkle proofs pass locally; a real finalized Devnet drop still reproduces its previous root and snapshot hash. This does not verify large holder indexing or payout throughput. |
| The build-identity check leaked `mainnet_conversion.rs`, causing its cleanup trap to fail after successful validation. | Medium | Cleanup includes the generated conversion file. Eleven invalid program identity/feature/conversion configurations are rejected and the valid fixture exits successfully. Shell files are pinned to LF for Windows/WSL checkouts. |
| Security regression tests were not a required application CI step. | Medium | Added `npm run test:security` to application and contract workflows. Tests cover signer budget concurrency, admin restrictions, durable-journal restoration, corrupt journals, release identity binding, deployed-byte verification and account flags. |

Client compatibility: Mainnet reward builders append a read-only guard account for both SOL and tokens. Mainnet buyback builders and independent price-review canonicalization agree on writable guard flags. The promotion builder accepts an explicit Mainnet cluster and marks its guard writable. Devnet instruction account layouts remain unchanged.

## Executed verification

All following results are **local-only**, using compiled SBF in LiteSVM or host tests. Router policies/funding are synthetic. The DEX cases execute captured public Devnet venue/fee bytecode and market state; the DEX itself is not mocked. No live transaction is implied.

- Mainnet-feature SBF: 24 passing cases — community custody/claims (3), developer escrow (7), protocol guard/reward/promotion controls (7), RICH configuration, handoff and stale-order controls (5), and excluded entrypoints (1 test checking 20 entrypoint names).
- Optional configurable Devnet SBF: 5 passing administration/market/stale-order/legacy-bypass cases.
- Protected/agency buy-and-burn: 8 passing external-program tests (10 flow executions, including donations) across PumpSwap and Pump curve; see the table below.
- Legacy-ABI Devnet SBF: 16 passing cases — community claims (3), developer escrow (7), token bitmap payout (1), unpaid-cycle expiry (1), receipt/bitmap rent and replay checks (3).
- Host contract test: 1 passing curve-account validation case. It stops before CPI and is not evidence of a completed swap.
- JavaScript security: 17 passing cases, including current/historical configuration decoding, owner instruction encoding, signed revision bytes, app fail-closed behavior and pricing-cache invalidation.
- Eleven invalid build configurations rejected; the valid explicit program fixture builds without embedded asset addresses.
- JavaScript syntax, source-size budgets and Vite production build pass.
- Historical verification from the earlier pause/cap patch: its two SOL payout regressions were run against the original pre-fix bytecode (`d2006da19720c2c9c6383cad05e9d684ea19591eacc737a06012e03ef1c676dc`) and both failed as expected. That earlier result does not certify the subsequently revised cap policy; the current uncapped-user policy is covered by the current tests above.

Reproduce using the pinned build/test commands in `.github/workflows/contracts.yml` and `npm run test:security`. Public fixture identities in that workflow are intentionally rejected by production runtime release validation.

Historical exact-head CI for the administration patch `76e22ab76dd3819f65061d07b78d59d0ad6becfe` passed [contract checks](https://github.com/roger-morrision/funded.app/actions/runs/44987529432) and [application/Docker checks](https://github.com/roger-morrision/funded.app/actions/runs/44987533319). These historical links do not claim to verify this later patch; run the workflows against its exact commit.

## Executed external-program buybacks

| Captured venue | Router policy | Spent lamports | Burned raw token units | Compute units |
| --- | --- | ---: | ---: | ---: |
| PumpSwap | Protected | 1,000,000 | 82,029 | 259,743 |
| PumpSwap | Agency category 6 | 1,000,000 | 82,029 | 262,796 |
| Pump curve | Protected | 989,999 | 16,813,522,243 | 187,291 |
| Pump curve | Agency category 6 | 989,999 | 16,813,522,243 | 190,142 |

Clean-case compute figures are recorded above; ephemeral addresses can cause small CU differences. The additional cases pre-fund the volume PDA, transfer three token units from an unrelated payer and, for pools, pre-fund either an uninitialized WSOL ATA or an initialized ATA holding more SOL than the buy budget. Existing tokens remain untouched and donated SOL returns to the vault. Both donation regressions fail against the prior `7073be14d9cfb48ea9b557c250bf385e6efe42dec3d441c57396b2c08ee2cc7d` binary while clean cases pass.

Each case uses the protected output quote, executes purchase and burn, verifies receipt against mint-supply and vault-balance changes, checks unchanged prior token custody/closed WSOL, rejects impossible slippage atomically and rejects replay. The versioned transaction uses a synthetic local address lookup table and must fit 1,232 bytes. The price co-signer is an ephemeral fixture key; this does not claim independent quote-review service coverage. Captured sysvars refresh the VM rent/clock cache, avoiding a mismatch between current Devnet rent and LiteSVM defaults.

Public snapshot/program hashes and explicit exclusions are recorded in [CPI evidence](evidence/buyback-cpi-2026-11-22.json). Binary snapshots remain in ignored `tmp/cpi-fixtures`. To capture current public state (which may change) and repeat:

```sh
node scripts/capture-cpi-fixture.mjs pool EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32 tmp/cpi-fixtures/pool devnet
node scripts/capture-cpi-fixture.mjs curve hW9zSUFAVDpAQURJuYu5S4jBw2SRW53mCuvQPQyYEDF tmp/cpi-fixtures/curve devnet
# Build the Mainnet-feature fixture with the pinned workflow, then for each venue:
FUNDED_MAINNET_PROGRAM_ID=3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh FUNDED_ROUTER_TEST_SO=/absolute/path/funded_fee_router.so FUNDED_CPI_FIXTURE=/absolute/path/tmp/cpi-fixtures/pool cargo test --locked --manifest-path contracts/funded-fee-router/Cargo.toml -p funded-fee-router --features mainnet-v3-program --test cpi_buyback -- --ignored --nocapture
```

Normal CI now captures public Devnet PumpSwap state and explicitly executes the four pool tests (six flows), archiving public snapshots/ELFs. Curve tests are explicitly run locally; ordinary cargo test skips these opt-in cases unless `--ignored` and a fixture path are supplied. A completed/migrated curve needs another public live-curve snapshot, not a mocked success.

Additional isolated compiled-SBF tests execute a paired USDC fee conversion and a category-7 own-coin agency milestone buyback with captured public Devnet PumpSwap and fee-program bytecode. In the conversion fixture, 1,000,000 USDC base units produced 228,059,467 lamports of credited SOL; a separate case pre-funded the temporary WSOL address with 700,000 lamports and verified that its return did not inflate the credit. The milestone fixture spent 1,000,000 lamports, burned 82,029 own-coin units, marked the selected agent complete, and rejected replay. Both cases check the relevant policy, receipt, custody and mint-supply deltas, plus impossible slippage and packet size. These are **local-only** tests with synthetic router funding and authority; they do not prove an app worker, live Devnet payout, migration claim or Mainnet deployment. [Fixture evidence](evidence/financial-cpi-continuation-2026-11-22.json) records slots and bytecode hashes.


## Dependency advisories

`cargo-audit 0.23.0` checked all 423 lockfile packages against RustSec database commit `55e1c3dfbd834237a05bbbf7b50ba3b5be27b662`. It initially reported two vulnerabilities. `ctutils` was updated from 0.4.2 to 0.4.4, resolving [RUSTSEC-2026-0385](https://rustsec.org/advisories/RUSTSEC-2026-0385.html).

[RUSTSEC-2026-0387](https://rustsec.org/advisories/RUSTSEC-2026-0387.html) remains for `crypto-bigint 0.5.5`. The path is LiteSVM → Solana syscalls → secp256k1 recovery → k256/elliptic-curve → crypto-bigint. Both affected packages are outside the normal/build dependency graph for both workspace programs across all targets; they enter through test dependencies. The patched crypto-bigint series is 0.7.6+, incompatible with the existing upstream 0.5 dependency constraint. An upstream SDK/test-runtime migration is still required; no advisory is suppressed or represented as fixed.

The full lockfile audit therefore still exits 1. It also reports maintenance warnings for `ansi_term`, `bincode`, `derivative`, `libsecp256k1` and `paste`; maintenance warnings are distinct from the two timing vulnerabilities. The recorded dependency graph scope does not constitute a general side-channel audit. Tests use ephemeral fixture keys only. Machine-readable results are in `docs/evidence/contract-dependency-review-2026-11-22.json`.

After the `ctutils` patch, the earlier 33 targeted bytecode tests passed with unchanged earlier ELF hashes. The current three variants and eight external-program tests total 53 passing SBF test executions, with hashes listed above. The dependency patch itself changes only the host test runtime.

## Supplied test mint

Read-only finalized Mainnet RPC evidence is stored in `docs/evidence/mainnet-test-mint-2026-11-22.json`.

`Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr` is a classic SPL mint with six decimals and neither mint nor freeze authority. A separate Devnet read returned no account. Its metadata was used in the isolated token-reward custody test; synthetic token balances were injected into LiteSVM.

The canonical SOL PumpSwap pool `B78z5Xp4f8sEDgXnjBB4hxFQiPZDCageod5j3NtBpB5B` and Pump bonding curve `EnUAdYkZQpssfamcu75RAe6smtE9bcWR4gvHmZhB3S25` did not exist at the recorded Mainnet slot. This does not rule out other venues, but this mint cannot yet supply evidence for the contract's supported buyback venues. It was not installed as a production RICH asset.

## Live Devnet migration

The user authorized completing one disposable Devnet QA curve. `Cp83URacwBZpMvVw2fSPtGy3RzWjD35AzF2KcKaYyENp` was bought with an in-memory disposable wallet; its purchase finalized at slot `525047780`, left zero curve tokens and marked the curve complete. Pump's own keeper migrated it at slot `525047790` into the canonical PumpSwap pool `EuAo1FPe5gnagHQgqZtzuTJyh32mx1BWRfq8Z4tCPF5P`, with nonzero token and WSOL reserves. The exact buy signature was reconciled after an RPC blockheight-confirmation timeout; it was never resubmitted. The purchased QA tokens were transferred to the Devnet service authority, the disposable token account was closed, and remaining SOL was returned so the disposable wallet ended at zero. [Finalized transaction and balance evidence](evidence/devnet-migration-2026-11-22.json) is rechecked by `node scripts/verify-devnet-migration-qa.mjs`.

The migration receipt passes the app's `verifyPumpMigrationTransaction` check, including its canonical-pool creation requirement. The read-only snapshot attempt now fails the expected historical-replay gate: at the checked finalized slot, 2,893 slots had passed since migration, while `captureExactCommunitySnapshot` permits at most 256. A current holder balance cannot be substituted for the historical migration snapshot; recovering this particular cutoff requires trustworthy archival exact-slot data. The isolated router also has no approved holder snapshot or community drop, and its reward vault holds no coin tokens. The live signer is allowlisted for the public app router, not this isolated QA router. No community airdrop claim was submitted, and migration alone does not make that acceptance case pass. The public Devnet app also remains on its previous router and ABI. The read-only verifier and [evidence](evidence/devnet-migration-2026-11-22.json) report the snapshot gate explicitly.

## Public Devnet financial and community re-verification

The active public app uses router `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`, separate from the isolated configurable router above. A read-only pass against its actual database and finalized Devnet chain rechecked the pinned executable bytes, **three** paired-token-to-SOL conversions (149 quote base units spent, 80,158 lamports credited across five source allocations), and **ten** category-7 own-coin milestone buybacks (419,603 lamports spent in total). Every conversion passed the stored-source allocation, conversion PDA, token debit and SOL-credit verifier. Every milestone passed the exact transaction, price-signer instruction, vault debit, burn and receipt verifier. See [financial evidence](evidence/devnet-financial-records-2026-11-22.json) and the repeatable read-only `scripts/verify-devnet-financial-records.mjs`.

Four public-app community manifests were rechecked against the funded reserve and deployed program. Three are based on real Pump migration receipts; one is a Devnet QA cutoff. One migration-based drop opened with its exact root and reserve transfer, then closed after **three** verified recipient token payouts and payment PDAs out of 28 manifest leaves. Two other migration-based manifests remained funded but never opened; their opening journals contain expired, unlanded attempts. All four had a 300-second QA claim window. The successful migration-based drop opened about 251 seconds after migration, leaving about 49 seconds for delivery; its three payouts finalized in that interval. This confirms a real migration-gated claim path on the public router, while full-holder delivery and timely opening remain **unverified**. The separate isolated-router QA coin still has no claim. See [community evidence](evidence/devnet-community-records-2026-11-22.json) and `scripts/verify-devnet-community-records.mjs`.

The hot signer also now denies router administrative instructions on extra allowlisted programs. A regression checks every denied instruction against an extra QA router while allowing an ordinary claim instruction. This closes an allowlist policy gap; the extra QA router has **not** been enabled in the live signer.

A separate [local holder-scale boundary check](evidence/holder-scale-gate-2026-11-22.json) confirms that automatic holder eligibility and funding both accept 1,000 recipients and reject 1,001. This is an application scheduling limit, separate from the removed SOL payout cap. It blocks a reward cycle for a larger eligible cohort; no million-holder payout has been verified. Raising the constant without a reviewed paged distribution, durable progress and realistic load tests would not establish safe scale.

The community manifest's snapshot-hash stack overflow is fixed locally. A [70,000-holder regression](evidence/community-manifest-scale-2026-11-22.json) passes, and the new hash reproduces an existing finalized Devnet migration drop's exact root and snapshot hash. This verifies manifest construction and backward-compatible hashing only; the historical holder index, automatic delivery and million-user throughput remain unverified.

A separate [70,000-holder reward manifest regression](evidence/reward-payout-scale-2026-11-22.json) passes edge-proof verification. This narrows the automatic reward scale blocker to eligibility, indexing, execution and persistence rather than Merkle construction. The current worker batches at most four recipients per Devnet transaction and submits one per Mainnet transaction. It records each payment through a locked rewrite of the entire reward ledger; five-minute holder snapshots also store complete balances there. At 70,000 recipients, current widths imply at least 17,500 Devnet or 70,000 Mainnet transactions before retries. These are code-derived lower bounds, not a throughput test. Do not raise the 1,000-holder gate without paged durable progress, capacity tests and a reviewed payout design.

## Administrator handoff during mint rotation

**RICH-HANDOFF-01 — local-only.** The compiled-SBF regression now rotates back to the second mint while a successor is nominated. Revision 4 captured the outgoing administrator and pending successor. Acceptance changed only the active authority fields, cleared the nomination, preserved configuration rent and left the revision 4 account intact. The outgoing administrator's revision 5 update failed without creating a history account. The successor's update succeeded and the original revision 1 account still matched. The case passed once on each ELF below. Live handoff remains unverified and requires the isolated router's current administrator to authorize the transfer.

| Tested input | Exact identity |
| --- | --- |
| Contract source | Base commit `1d3bbf40447f71430d20ccdfd49ad8503c8b8f89`, router `src` Git tree `dd2f57ffe841adaca9b2e033950633247f64c7ac` |
| Regression | `rich_assets.rs` Git blob `6795e02c603d67830178dea40cb4ee1336c25efe` |
| Mainnet-feature public fixture ELF SHA-256 | `6bfa0414eaf68b6dd3d2c5cda79e0454c0255e2da4ac80c7466f79e2913ce320` |
| Isolated configurable Devnet ELF SHA-256 | `7b4b6bab3605135fb251894ca558f425f8bdc4c42e0de46ebfb00e135247c25f` |

From `contracts/funded-fee-router`, with `FUNDED_ROUTER_TEST_SO` set to the matching ELF and the public fixture program ID set as in [the candidate manifest](../config/contract-build-candidates.json), run `cargo test --locked -p funded-fee-router --features <features> --test rich_assets asset_admin_can_rotate_after_immutability_and_handoff_preserves_history -- --exact` for `mainnet-v3-program` and `devnet-v3-program,configurable-rich-assets`. From the repository root, `node --test tests/security/rich-assets.test.mjs` passed all seven cases and `npm run check:structure` passed.

**Live-verified identities.** A read-only finalized Devnet account batch at slot `525063603` matched both executable Loader-v3 program pointers, ELF hashes and full ProgramData hashes to the [isolated router record](evidence/devnet-configurable-rich-2026-11-22.json) and [public app record](evidence/devnet-financial-records-2026-11-22.json). The public app ELF SHA-256 was `c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15`. No transaction was submitted. Next case: establish whether an entitlement created before rotation was paid after rotation, using finalized transaction ordering and custody and recipient deltas.

## Creator entitlement paid across primary RICH rotation

**RICH-ENTITLEMENT-01 — live-verified on the isolated Devnet router.** The old cohort's protected policy allocated 4,000,000 of 8,000,000 directed units to the creator. During revision 1, settlement debited 840 lamports from the cohort router and credited 672 fee lamports to its category-0 vault, establishing a 336-lamport creator share. After revision 2 changed the primary RICH mint, the same policy and vault paid that share in SOL. The finalized claim and withdrawal accounts matched their derived addresses, mint, and amounts. The withdrawal also matched category 0 and the creator recipient.

| Finalized Devnet receipt | Slot | Observed change |
| --- | ---: | --- |
| [Configure revision 1](https://explorer.solana.com/tx/3borkRYq6qqixMxBEKQzJBfQA6qg62XYRbnkM9gP3wFmNAUQh1z5xpr46bRh6A8u9vtbAxSPz2g7jrY8zurkwQjD?cluster=devnet) | 524977848 | Revision 1 history recorded the original RICH mint and market. |
| [Settle old cohort](https://explorer.solana.com/tx/2pzSYVqKbSzBgsuVaUpo4CJeyScA21a6p3vz9cjNSZXEsE1HADzSCHe7dWk725wLBmh2hMgPTZNXsp6x4C5MFyXm?cluster=devnet) | 524979123 | Category-0 vault rose from 0 to 650,912 lamports, including 650,240 rent. |
| [Configure revision 2](https://explorer.solana.com/tx/469L31P4VeMjjqL1BSkurZYpNtifndUb4CpRFeUSPty7W6b6H96wYcrjywQ1PJgVF6rqYKQ1SxhVx2d7ovFmgbVK?cluster=devnet) | 524979397 | Revision 2 history recorded the replacement mint and market. |
| [Pay old cohort's creator](https://explorer.solana.com/tx/19D3LKxrNbxj526gSMQHSSurKbphcRcnqypF3M5z7D4pYYTCLXoBE2ZAGrihSTW6VrPXMnQ5sBZGMYb3avuGWXp?cluster=devnet) | 524980272 | Vault fell from 650,912 to 650,576. The inner System Program transfer credited the creator 336 lamports. |

The creator also paid the 5,000-lamport fee and funded the withdrawal receipt with 1,264,920 lamports. Its wallet moved from 4,810,187,595 to 4,808,918,011 lamports. Adding those costs to the wallet delta recovers exactly 336 lamports. The withdrawal receipt was `B4g6AKG8AuBw64JYBr5s9YKhrKYVA1qZVwcGQruqAyB3`.

At source revision `ff2aac18e10612211f9d78817a7316ab504ac999` (contract source tree `dd2f57ffe841adaca9b2e033950633247f64c7ac`), read-only Devnet RPC calls used `getGenesisHash`, finalized `getTransaction` with `jsonParsed`, and finalized account reads. At slot 525071189 both executable loader pointers and full ProgramData hashes matched the [isolated](evidence/devnet-configurable-rich-2026-11-22.json) and [public app](evidence/devnet-financial-records-2026-11-22.json) records. The isolated router's last deployment slot was 524977616, before all four receipts. Its ELF SHA-256 was `7b4b6bab3605135fb251894ca558f425f8bdc4c42e0de46ebfb00e135247c25f`. The public app ELF matched `c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15`. Local check `node --test tests/security/rich-assets.test.mjs` passed all seven tests.

The old cohort's pinned holder, bonus and launched-token cycles were created at slots 524980307, 524980328 and 524981104, all after rotation. Live cross-rotation payment for these reward types remains unverified.

## Holder reward committed before primary RICH rotation

**RICH-ENTITLEMENT-02 — local-only.** A funded SOL vault committed 500 lamports to two Merkle leaves under RICH revision 1. Rotation to revision 2 preserved the cycle, reserve, vault and recipient accounts byte for byte. At maturity the original proof credited the first holder 336 lamports, debited the vault by 336 and left 164 reserved for the other holder. The payment receipt recorded the original cycle, holder, index and amount. A second submission with a fresh blockhash failed and preserved all five accounts.

The [compiled-SBF regression](../contracts/funded-fee-router/programs/funded-fee-router/tests/rich_assets/holder_reward.rs) passed on the Mainnet-feature fixture ELF `6bfa0414eaf68b6dd3d2c5cda79e0454c0255e2da4ac80c7466f79e2913ce320` and the isolated Devnet ELF `7b4b6bab3605135fb251894ca558f425f8bdc4c42e0de46ebfb00e135247c25f`. Source base `c1c4242872b2aca84e1f814445e7860702a6ea83`, router source tree `dd2f57ffe841adaca9b2e033950633247f64c7ac`, regression blob `6184be6a3bc03aff0a58bf17177bd0f8e910f277`. With the fixture IDs, ELF paths and feature sets specified under administrator handoff, run `cargo test --locked -p funded-fee-router --features <features> --test rich_assets holder_reward::committed_holder_reward_pays_after_rotation -- --exact`. Both runs executed one case using the application-generated Merkle root. A host property check with `buildRewardManifest` and `verifyRewardProof` covered all 499 positive two-holder splits of 500 lamports and verified both original proofs for each split. `node --test tests/security/rich-assets.test.mjs` passed seven cases and `npm run check:structure` passed.

**Devnet identity check.** At finalized slot 525078861 both Loader-v3 addresses, executable pointers, full ProgramData hashes and ELF hashes matched the [isolated router](evidence/devnet-configurable-rich-2026-11-22.json) and [public app](evidence/devnet-financial-records-2026-11-22.json) pins. This run used read-only RPC. A live holder result still requires an authorized isolated rotation between commitment and payout.

## Launched-token reward committed before primary RICH rotation

**RICH-ENTITLEMENT-03 — local-only.** Under RICH revision 1 the launched-token vault committed 500 raw SPL units across two holders. Rotation to revision 2 preserved the vault, token accounts, mint, cycle and reserve byte for byte. At maturity the original proof moved 336 units. Custody fell from 500 to 164, the recipient rose from 5 to 341, mint supply stayed at 505, and the reserve retained 164 for the second holder. The receipt recorded 336 units delivered. Replay with a fresh blockhash failed and preserved the balances, liability and receipt.

Tested base `220e05d008dfa8021ea25000e52fc38df47047a0`, router source tree `dd2f57ffe841adaca9b2e033950633247f64c7ac`, [regression](../contracts/funded-fee-router/programs/funded-fee-router/tests/rich_assets/token_reward.rs) blob `51884f0cbbd8a1c7e8b0a90c0e455b6725b0f612`. With the fixture IDs and `FUNDED_ROUTER_TEST_SO` set as in the handoff case, `cargo test --locked -p funded-fee-router --features <features> --test rich_assets token_reward::committed_launched_token_pays_after_rotation -- --exact` passed once per ELF.

| Feature set | Tested ELF SHA-256 |
| --- | --- |
| `mainnet-v3-program` | `6bfa0414eaf68b6dd3d2c5cda79e0454c0255e2da4ac80c7466f79e2913ce320` |
| `devnet-v3-program,configurable-rich-assets` | `7b4b6bab3605135fb251894ca558f425f8bdc4c42e0de46ebfb00e135247c25f` |

Host checks with `buildRewardManifest` and `verifyRewardProof` verified both proofs for each of the 499 positive two-holder splits of 500 units. The 336/164 split supplied the regression's root and proof. `node --test tests/security/rich-assets.test.mjs` passed seven cases and `npm run check:structure` passed.

**Devnet identity and live blocker.** A read-only finalized account batch at slot 525085856 matched both loader pointers, full ProgramData hashes and ELF hashes against the [isolated router](evidence/devnet-configurable-rich-2026-11-22.json) and [public app](evidence/devnet-financial-records-2026-11-22.json) pins. The public ELF SHA-256 was `c320a6139dbcba2daa9ab3e04e0e13435b6ea6ba9a80538097c7c25681298a15`. Live acceptance requires an authorized isolated rotation between commitment and payout.

**Next case.** Check that a daily bonus committed before rotation pays the original winner and debits the correct bonus vault. Reuse the existing SOL payout coverage and exercise the bonus-specific funding and winner selection.

## Remaining deployment blockers

1. **Production identities are unavailable.** Select the dedicated program address, production RICH mint and supported pool, guardian, fresh operational/price signers and approved upgrade authority. Compile the dedicated production program identity, reproduce and review the bytes, then initialize the owner-controlled RICH configuration with the supported production mint/market. Subsequent RICH changes do not require recompilation. No private keys should enter this report or repository.
2. **Final funding is unquoted.** A Mainnet RPC quote gives 5.464378200 SOL locked rent for the current test fixture, before fees, initialization, liquidity or the plan's 3 SOL operating reserve. The user removed the aggregate deployment spending cap. Evidence is in `docs/evidence/mainnet-contract-rent-2026-11-22.json`. Final production bytes and the full transaction inventory need a fresh quote.
3. **End-to-end financial acceptance remains incomplete.** Local protected/agency category-6 CPI/burn, paired-token conversion, category-7 milestone buyback and RICH administration pass. The existing public Devnet app has three finalized conversion and ten finalized milestone transactions reverified above, but the isolated configurable router and Mainnet-feature binary have no matching live acceptance. Every fee category, the full token-extension matrix, operational authority recovery and a live canary still lack complete current acceptance evidence. Compiling or simulating these paths is not proof they execute successfully on a live cluster.
4. **Mainnet application signing/worker integration remains blocked.** The operational signer and price-signer bootstrap still reject non-Devnet operation. Launch/registration, metadata, workers and journals retain network gates. Their restrictions were preserved; switching a cluster string would not constitute a safe implementation.
5. **Full independent review is outstanding.** The production release configuration requires a review tied to exact source/binary hashes. This self-review does not satisfy that gate. Do not fill those fields with this report to bypass it.
6. **Migration snapshot recovery and scale are unproven.** The live QA migration missed the 256-slot reverse-replay window and cannot produce an exact holder snapshot from current balances. The worker also searches only that recent window. Before release, verify the funded-reserve-to-migration-to-snapshot timing with a fresh coin and test a trustworthy archival recovery path and realistic holder counts; otherwise an eligible airdrop can become permanently unavailable.
7. **Automatic holder rewards have a 1,000-recipient gate.** The scheduler rejects 1,001 eligible wallets before preparing a cycle. A million-user payout needs a reviewed paged or sharded entitlement model, complete holder indexing, durable recovery and scale acceptance; changing the limit alone is unsafe.

## SOL funding estimate

The fresh merged-program deployment uses **5.464378200 SOL** of rent at the finalized Mainnet quote. It does not need a separate developer-escrow program. Exact-size allocation is assumed.

| Component | SOL | Basis |
| --- | ---: | --- |
| Program + ProgramData rent | 5.464378200 | Live RPC, 1,075,328-byte fixture |
| Upload/transaction fee allowance | 0.025 | Base-fee estimate 0.01198; allowance for retries |
| Deployment contingency | 0.250 | Existing plan |
| Initial accounts and setup | 0.050 | Provisional allowance, inventory not final |
| Small canary | 0.050 | Provisional allowance, trades not specified |
| Operating reserve | 3.000 | Existing plan |
| **Illustrative technical funding** | **8.839378200** | Excludes token launch/liquidity |
| **Suggested technical wallet budget** | **10.000** | Rounded planning headroom |

The first RICH configuration plus revision account costs 0.0030988 SOL rent; each later revision currently adds 0.0015494 SOL plus its transaction fee. Two-step administrator handoff creates no additional account. Refresh prices immediately before execution.

Buffer rent (5.463504440 SOL) is reusable at fresh same-payer Loader-v3 finalization, not a second permanent rent charge: [Agave's loader implementation](https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L259) returns it to the payer before creating ProgramData. Upload fees depend on actual messages/retries and priority prices; the base fee is [5,000 lamports per signature](https://solana.com/docs/core/fees). There is no aggregate deployment spending cap in the current plan. This is a technical estimate, not authorization to deploy. Estimated technical funding remains **10 SOL plus the separately chosen token launch/liquidity allocation**, with hosting and review priced separately.

Run `node scripts/quote-mainnet-contract-budget.mjs` to refresh public rent evidence. Final production identities can alter bytes; re-quote the exact reviewed artifact and transaction plan. The proposed SBF-v0 deployment-disable feature was absent at the recorded Mainnet slot; [feature evidence](evidence/mainnet-sbf-features-2026-11-22.json) must also be refreshed before release.

## Guard policy and residual trust

The administrative cap is denominated in **SOL** and applies to operations withdrawals, promotions and buybacks. Verified creator/X/referral disbursements, reward-vault transfers, reward commitments and SOL/token user payouts do not consume this cap. Mainnet reward cycles retain the 24-hour guardian review delay; payouts retain pause, liability, recipient/proof and replay checks. The canonical payout guard is read-only to avoid global write contention.

Token payouts obey pause and immutable per-cycle liabilities, but the global SOL cap does not cap raw token units. Token valuation/per-asset risk limits require a separate policy decision and review. Community snapshots require owner authorization; developer escrow release and user entitlement claims retain their separate custody rules. A global worker pause is not a promise to freeze every user-owned asset.

The retained upgrade authority can replace the code. Operational controls, guardian monitoring, independent price signing and recovery rehearsals remain part of the security model. No Mainnet signing, deployment, funding or runtime activation occurred during this review.
