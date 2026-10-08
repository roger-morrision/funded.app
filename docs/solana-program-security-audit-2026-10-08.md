# Solana program security audit — 2026-10-08

## Scope and evidence

Reviewed the tracked Anchor program in `contracts/funded-fee-router/programs/funded-fee-router/src/` (all 12 Rust source files), its three Rust integration tests, the Solana instruction builders and reward/community service paths, and the tracked `mnt-c-data-dev-apps-funded-app-contracts-funded-fee-router` scaffold. The scaffold contains only a greeting `initialize` instruction and is not the active fee-router implementation. This is a source review of commit `a9e0c37` on branch `enhance/architecture-security-ops`; it is not an attestation of the deployed program bytes or current Devnet account state.

Severity describes the impact if the stated preconditions hold. No transaction was submitted and no production key was used.

## Findings

### F-01 — High: fee split and claim provenance are not enforced on chain

`settle_mint` accepts an arbitrary 32-byte `claim_id`, one arbitrary writable destination, and any positive amount up to the mint router's balance above rent. It checks the authority and router header, but does not verify a Pump collection receipt, bind the `claim_id` to a collection, or enforce the published 80/20 recipient split. The legacy `settle` accepts any number of destinations with the same absence of provenance and allocation checks. The `POLICY_HASH` comparison checks metadata, not the policy arithmetic. A compromised or dishonest router authority can send all available SOL to a chosen third-party account while creating a valid claim record. The destination cannot be the authority itself in `settle_mint`, but that does not prevent payment to an account the authority controls.

Evidence: [settle.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/settle.rs) lines 29–58 and 62–89; [distribution-policy.js](../distribution-policy.js) lines 20–27; [fee-router.js](../fee-router.js) lines 66–95. The app's off-chain settlement checks may reduce operational risk, but direct program calls bypass them.

Remediation: decide whether the router is explicitly a custodial authority or whether 80/20 is an on-chain guarantee. For an on-chain guarantee, store the authorized beneficiaries and split parameters in program-owned state, verify the settlement source through an authenticated on-chain mechanism, and enforce exact allocations in the instruction. Until then, describe the split as an operator policy and monitor all router outflows.

### F-02 — High during new deployment: first caller chooses the permanent initial router authority

`initialize` only requires an arbitrary signing payer and an empty legacy router PDA. It does not check the program upgrade authority or an expected initializer before writing that signer's key into the router header. If initialization is sent separately after deployment, another funded account can initialize the PDA first, become settlement authority, and cause new mint routers to inherit its key. Recovery then requires cooperation of the attacker as `old_authority` in `rotate_authority`, or a program upgrade.

Evidence: [initialize.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/initialize.rs) lines 5–36 and 52–80; [rotate.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rotate.rs) lines 7–15 and 41–69. This does not establish that the already initialized Devnet router is compromised.

Remediation: gate initialization with the program upgrade authority or a compiled deployment authority. If an upgradeable program needs a new router after a migration, deploy and initialize atomically where feasible and verify the resulting header before routing fees.

### F-03 — High during key compromise: rotation can leave old mint routers spendable

`rotate_authority` changes the legacy router and only the mint routers explicitly passed in `remaining_accounts`. `settle_mint` trusts each mint router's stored authority and does not compare it with the current legacy router. An omitted mint router therefore remains spendable by the old key after a successful rotation event. The program has no registry or revocation epoch to make rotation complete atomically.

Evidence: [rotate.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/rotate.rs) lines 48–70; [settle.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/settle.rs) lines 29–35. The historical [Devnet rotation record](devnet-router-rotation-2026-09-30.md) says 21 routers were checked at that time; current completeness was not reverified.

Remediation: make `settle_mint` require the current legacy authority (or a global authority epoch) in addition to the mint header. Keep an independent, finalized mint-router inventory and reconcile every header after any rotation.

### F-04 — High for a fee-bearing Token 2022 drop: claims and closeout can become impossible

The community drop accepts `TokenInterface`, including Token 2022 mints. Claim and closeout use `transfer_checked`, then require the recipient token balance to rise by the full transfer amount. Token 2022's transfer-fee extension withholds a fee at the destination, so a positive-fee transfer fails the post-transfer check and the entire transaction rolls back. A drop opened while the fee is zero can become unclaimable if the mint's fee is increased later; the remainder closeout has the same check, leaving the escrow locked without an alternate withdrawal path. Initialization also requires the drop vault to receive the full deposit, so a positive fee at opening is rejected.

Evidence: [community.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/community.rs) lines 113–121, 174–190, 238–262, and 285–311. Solana documents that `TransferChecked` on a transfer-fee mint automatically withholds the fee from the destination: [Transfer Fees](https://solana.com/docs/tokens/extensions/transfer-fees).

Remediation: reject transfer-fee mints at drop creation, or explicitly account for the fee and add a safe closeout path for already opened drops. Add a Token 2022 integration test that activates a fee after opening.

### F-05 — Medium: reward-token payments record gross amount, not net receipt

`payout_reward_token` records `amount` and advances `distributed_amount` after `transfer_checked`, without reloading the recipient token account or checking the net balance increase. With a Token 2022 transfer-fee mint, the recipient receives less than the recorded amount. The service does detect a short recipient delta for new payouts, but by then the on-chain payment PDA exists; a retry cannot pay the same recipient from that cycle. The service's already-paid branch also treats an existing matching payment record as balance verified without rereading the recipient balance.

Evidence: [reward.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward.rs) lines 203–225; [automatic-reward-chain.mjs](../server/automatic-reward-chain.mjs) `submitLeaf` payment lookup and token balance check. The transfer-fee behavior is documented in [Solana Transfer Fees](https://solana.com/docs/tokens/extensions/transfer-fees).

Remediation: reject transfer-fee mints for this payout path or commit and verify the intended net payout using fee-aware transfers. Reconcile existing payment PDAs against finalized token deltas before marking them paid.

### F-06 — Medium: reward cycles can promise more than their vault can pay

`create_reward_cycle` commits a `total_amount` and Merkle root without reserving either SOL or tokens for that cycle. Multiple cycles can share a vault, and later payouts only check the vault's current balance. An earlier cycle can consume funds needed by another, while the unpaid cycle remains immutable. There is no cancel, top-up accounting, or close/recovery instruction for malformed or permanently incomplete cycles.

Evidence: [reward.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/reward.rs) lines 60–85, 106–112, 155–163, and 203–225; [lib.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/lib.rs) lines 13–117.

Remediation: reserve liabilities per asset/cycle before cycle creation, enforce vault balance against all outstanding commitments, and define an audited recovery path for residual funds.

### F-07 — Medium trust boundary: migration evidence is stored but not verified by the program

`fill_drop` checks that migration slot and signature and snapshot hash are nonzero and that the two slot numbers match. It does not verify the signature against a finalized migration transaction or recompute the snapshot root. The public `initialize_community_drop` path also does not check the current router authority. The app service performs stronger off-chain Devnet checks, but a direct caller can create a funded drop with self-selected eligibility metadata. Indexers should not interpret program state alone as proof of an exact historical snapshot.

Evidence: [community.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/community.rs) lines 9–37, 128–157, and 160–193; [community-claim-service.mjs](../server/community-claim-service.mjs) lines 18–69.

Remediation: make the trust model explicit; require an approved attester or registry for snapshots if program state is intended to be authoritative, and have consumers verify the finalized off-chain evidence and expected authority.

### F-08 — Medium: closeout does not bind the source to the funded drop vault

`CloseCommunityDrop` checks that `vault_token_account` is owned by the drop PDA and has the right mint, but does not require the canonical associated token account created at opening. Anyone can create another token account owned by the drop PDA and fund it. After expiry, if that account holds at least the remaining committed amount, the caller can close the drop using it; `drop.closed` becomes true while the original funded vault remains inaccessible through the claim and close instructions. This is a costly but real escrow liveness attack. `ClaimCommunityDrop` also omits canonical vault binding.

Evidence: [community.rs](../contracts/funded-fee-router/programs/funded-fee-router/src/instructions/community.rs) lines 225–230 and 270–312; the canonical ATA is created at lines 25–35 or 68–78.

Remediation: constrain the vault account to the drop PDA's associated token address for the mint and token program in both claim and close contexts. Test with a second token account owned by the same PDA.

### F-09 — Low deployment hazard: duplicate scaffold declares the production program ID

The tracked scaffold under `mnt-c-data-dev-apps-funded-app-contracts-funded-fee-router/` contains a greeting-only program but declares the same ID as the real fee router in its `lib.rs` and `Anchor.toml`. Its configuration targets localnet, so no live overwrite was observed. A mistaken deployment using this scaffold and an authorized upgrade key could replace the actual program with an incompatible binary.

Remediation: remove the scaffold from the deployable tree or assign it a separate local-only program ID, and require a reviewed binary hash before every upgrade.

## Verification and limits

- `node --test tests/community-claim-chain.test.mjs tests/community-claim-service.test.mjs tests/community-reserve-drop.test.mjs tests/finalized-reward-send.test.mjs tests/reward-scheduler-qa-minimum.test.mjs`: **16 passed, 0 failed** after the source changes.
- `node scripts/verify-mint-router-v2.mjs`, `node scripts/verify-launch-matrix.mjs`, and `node scripts/verify-reward-contract-source.mjs`: passed local builder and source checks.
- WSL `cargo build-sbf --tools-version v1.54` produced a fresh SBF binary at `/home/tuan/funded-router-sbf-out/funded_fee_router.so`, SHA-256 `5113bea07c8eef9aa8ec519789776d57b4d8e1e4b35afc37dc54dad2ee85e488`. `cargo test --locked` against that exact binary in LiteSVM: **10 passed, 0 failed**. This verifies the changed local source only.
- No Devnet deployment, account migration, deployed ProgramData hash comparison, confirmed transaction, or Mainnet state was performed. The local binary hash is not a deployed ProgramData hash.
- `node scripts/verify-community-router-local.mjs` was **unavailable** because its required local service at `127.0.0.1:18899` was not running (`ECONNREFUSED`). This was not counted as a passing check.
- Existing `test-results/` was untracked before this audit and was left untouched.

## Remediation status after the source changes

| Finding | Status | Evidence and remaining work |
| --- | --- | --- |
| F-01 | Partial | New mint fee ledgers cap cumulative creator spending at 80% and protocol spending at the remaining 20% of mint-router receipts, with integer rounding assigned to the protocol share. Settlements require the launch creator and current router authority to sign. Legacy shared-router settlement is disabled. Existing mints need a co-signed ledger migration with the exact current router balance and attested historical creator/protocol spending; the program checks both prior spending totals against the cumulative split. The program still does not authenticate a Pump collection receipt or enforce the exact launch-specific creator-wallet, holder, and X allocation. Creator approval is implemented only for an X claim; holder, creator, community, operations, and buyback payouts still lack their complete approval flows. |
| F-02 | Source fixed | Initialization now requires the upgrade owner to sign and validates ProgramData. Existing deployed initialization state was not rechecked. |
| F-03 | Source fixed | Mint settlement checks the authority in the current legacy router, so an omitted mint router cannot be spent by a rotated-out key. The rotation inventory still needs operational reconciliation. |
| F-04 | Partial | Claim and closeout now accept a positive net token receipt below the gross debit, and closeout can drain the canonical vault even when the net receipt is zero. A claim with a 100% transfer fee cannot deliver a positive amount. No fee-bearing Token 2022 integration test was run. |
| F-05 | Source fixed for new payments | New reward payment accounts record the net token amount and the service verifies the recipient delta. Older payment accounts without the net field require manual reconciliation. |
| F-06 | Source fixed; Devnet inventory required | A per-vault, per-asset reserve tracks outstanding cycle liabilities. Cycle creation checks the unreserved SOL or token balance; payout releases liability; community escrow cannot drain a token vault with outstanding reserved claims. Legacy SOL and token cycle migration instructions reserve the unpaid portion only if the vault can cover it; the service migrates a legacy cycle only when its manifest matches. LiteSVM tests reject SOL and token overcommit and verify one-time legacy SOL migration. Before upgrade, enumerate all existing cycles and top up any underfunded vault; old cycles cannot be paid until migrated. |
| F-07 | Source fixed as governed attestation; evidence remains external | Both drop opening paths require an immutable program-owned snapshot approval signed by the program upgrade owner and match every committed snapshot field. Public opening also verifies the current router authority. The approval instruction can be prepared by the service. The upgrade owner must review and sign it, and the program still cannot independently prove an old finalized transaction; the off-chain evidence service remains the source of that historical fact. |
| F-08 | Source fixed | Claim and closeout require the canonical drop vault ATA; a regression test covers a second PDA-owned token account. |
| F-09 | Source fixed | Removed the duplicate deployable scaffold with the production program ID. |

The new instruction layouts are incompatible with the currently deployed program until an approved upgrade. `mintRouterReadiness` reports the missing creator co-sign flow; the launch UI checks this readiness and blocks new mint-router launches. Do not pin a local SBF hash as a Devnet ProgramData hash or resume routing fees until the program upgrade, creator approval UX, old-mint balance reconciliation, a complete legacy-cycle inventory and migration, snapshot approval signing, and the finalized evidence checks are completed and verified on Devnet.

## Deployment gate observed on 2026-10-08

Finalized Devnet reads show the deployed router ProgramData SHA-256 remains `9ce7c1137d250ffa84668e65b53546b7c1d4239eaf888957c41316708cda977b`, different from the reviewed local SBF binary. The program owns 97 legacy reward cycles (173-byte layout), of which two SOL cycles have 1,000,000 and 10,000,000 lamports unpaid. Their vaults currently have 5,000,000 and 10,000,000 lamports available above rent, respectively. This is a point-in-time balance check, not a completed migration. The program also owns 61 mint routers, 25 with a combined 6,318,001 lamports above rent. Their balances and historical settlements must be reconciled before a signed migration snapshot is prepared.

The public `https://funded.vip` origin still serves build `ui-review-fb99fc7` and reports mint-router readiness as true. Its general readiness response reports missing production gates. The current source builds and passes the isolated release contract, but deploying it before creator co-signing, ledger and cycle migration, and finalized Devnet payout checks would disable new launches and could interrupt existing reward flows. A fresh in-memory Devnet test wallet reached the public RPC, but its faucet request failed with an internal error; no wallet-funded end-to-end transaction was confirmed in this run. Keep the live deployment and on-chain program unchanged until these gates pass.

## Local follow-up fixes

- Reward-cycle token creation, legacy token-cycle migration, and token payout now require the reward vault's canonical token account. Token payout also requires the recipient's canonical associated token account. LiteSVM rejects a second token account owned by the same vault PDA and a second account owned by the recipient, then pays successfully to the recipient's canonical account.
- Token vault funding verifies the gross source debit and positive net destination receipt. Funding requests, buy-and-distribute, and the pool-funding script schedule the verified net amount so Token 2022 transfer fees cannot create an unfunded reward promise. An interrupted token funding request is held for reconciliation instead of being transferred again automatically.
- Buy-and-distribute now uses the existing exact-signature finalized transaction sender. Ambiguous RPC errors no longer trigger a freshly signed buy with a new blockhash.
- The follow-up local SBF binary SHA-256 was `43f2dd242cb6077ddba154f64630d55d4bd9622f33327413320a5496ed5cc44b`. All 10 Rust tests and 19 targeted JS tests passed against that changed source, along with the local app build, isolated release check, and mocked reward verifier. This hash is a local artifact, not a deployed ProgramData hash. Creator co-signing and live Devnet end-to-end checks remain open; this follow-up has not been deployed.

## Signed funded-router migration follow-up

The migration instruction now accepts historical creator spending, historical protocol spending, and the expected router balance above rent. The creator, current router authority, and program upgrade owner must all sign. The program requires the live router balance to match exactly and verifies that prior spending fits the cumulative 80/20 limits before initializing the ledger. LiteSVM rejects a stale balance snapshot, an excessive creator allocation, and missing signers; it accepts a funded router with an in-policy history. The new local SBF binary SHA-256 is `94c0ef6f79ebc530c67771cdfbd4d5ac49a3ea77d9224ac0304743d32eeef315`; 10 Rust tests and the mint-router JS builder check passed. The historical spending figures require independent reconciliation against finalized claims and the application ledger before anyone signs a live migration. No funded router was migrated on Devnet in this follow-up.

## Creator-signed X settlement follow-up

An X claimant can verify and bind a wallet, then share the claim ID with the launch creator. The creator's profile prepares the exact Devnet settlement transaction and asks the connected creator wallet to sign it. The API verifies the exact instruction, recipient, amount, creator signature, launch record, router, and mint fee ledger before adding the router authority signature. It saves the expected signature before broadcast, polls for a finalized receipt, and reconciles only against a saved exact signature and matching claim PDA. This is a local source implementation; no creator-approved Devnet transaction or recipient balance delta has been observed. A prior on-chain claim without a saved signature requires manual reconciliation. General mint-router readiness still blocks new launches because the other payout paths do not yet support creator signing.

The automatic SOL reward worker now parks a funding request as `awaiting-creator-signature` when the unsigned mint-router builder rejects it, instead of repeatedly retrying it as `verification-pending`. The chain methods also reject before initializing a vault, so an unsigned request does not spend rent. These other payout flows remain unavailable until their creator approval and finalized delta checks are implemented.
