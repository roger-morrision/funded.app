# Mainnet launch readiness

Product workflows: [all-page guide](product-guide.md). Documentation scope and dated evidence: [index](README.md).

## Deployment and go-live sequence (8 November 2026)

The requested deployment is a **fresh isolated Mainnet installation**. Provision new program and infrastructure identities and production signer references. Start with an empty production financial database and cache; do not copy Devnet launches, balances, receipts, sessions, pending transactions or QA private keys. Select/bootstrap the production FUNDED mint and real canonical pool before freezing the contract build. Record liquidity funding separately from contract rent and deployment fees. The admin recipient and retained upgrade authority must be explicitly selected public addresses. No existing Devnet reset, wallet transfer or deletion is part of this plan.

**Current decision: NO-GO for public Mainnet writes.** Placeholders are intentional. The steps below describe the release order, not evidence that these steps have passed. The current preflight deliberately returns `ready:false`; replacing configuration alone cannot complete the network port. Keep the existing Devnet environment available throughout preparation.

1. **Finish the Mainnet application paths.** Complete launch submission/registration, fee collection and settlement, every payout worker, market indexing and claim reconciliation. Bind quotes, stored obligations, RPC genesis, program identity and transaction receipts to the selected network. Review and test an explicit activation mechanism only after these paths are complete; the current backend blocks all Mainnet mutations. Flipping browser flags does not activate the backend.
2. **Freeze and test a release revision.** Use a clean checkout, Node 24 and the pinned contract tools in `.github/workflows/contracts.yml`. Run the commands below and the compiled-bytecode custody tests in that workflow. Run every case in `config/mainnet-acceptance-plan.json` on Devnet at production thresholds, including real Phantom interaction. The admin must be the authenticated, allowlisted Phantom wallet, pay the network fee and receive the withdrawal after one email OTP. Record finalized signatures and exact deltas; an HTTP success or submitted transaction is insufficient.
3. **Choose production identities and provision infrastructure.** Supply a dedicated program identity, retained upgrade authority, admin wallet, automation signers, fee recipients, Mainnet FUNDED mint and canonical pool, and deployment payer reference. Provision isolated PostgreSQL, Redis, durable metadata, HTTPS domain, RPC and same-network fallback. Test database restore, RPC credit exhaustion, WebSocket reconnect and metadata retrieval. Production signer/credential values stay in private server files; public browser variables contain no secrets. Select total deployment/canary and priority-fee limits.
4. **Fill a private production configuration.** Start from `config/mainnet-staging.example`; keep placeholders in the committed template. Complete `config/mainnet-deployment-plan.json` and `config/mainnet-acceptance-plan.json` with public identities and references when available. The V3 router and developer escrow use the same merged program ID. Client/server mint and pool must match the contract build inputs. Keep `VITE_ALLOW_MAINNET=false` and `VITE_MAINNET_READ_ONLY=true` during preparation. Run the offline preflight against the explicit private file.
5. **Build and independently review the exact contract.** Run the build-only command below using actual public production identities. Reproduce its bytes in CI from the same clean revision; review custody, authorization, all financial instructions, compute budgets and account migrations. Populate `config/mainnet-program-release.json` with the independent review and final source/binary identity. Its ProgramData hash is finalized after deployment. Test-only identities in `contract-build-candidates.json` must never become runtime trust or deployment inputs. Any production identity, mint, pool or source change requires another build and matching review.
6. **Refresh costs and approve the exact deployment.** Quote live Mainnet rent for the verified ELF length plus loader accounts; include bounded transaction/priority fees, retry allowance, initialization, lookup tables and capped acceptance funding. The existing `prepare-mainnet-deployment.mjs` is a read-only reference-artifact cost planner, not a deployment runner; its plan/artifact hashes must match. Fund only after reviewing the final program ID, payer, authority, bytecode hash and total spend limit. No exact deployment cost is established by a placeholder plan.
7. **Deploy the upgradeable program once.** After the previous gates pass, prepare a concrete command using the installed CLI's `solana program deploy`, an explicit Mainnet RPC, the reviewed ELF, explicit `--program-id` signer, `--fee-payer`, `--upgrade-authority` and exact reviewed `--max-len`. Set bounded priority/retry parameters from the approved packet. Do not use `--final`: the user requires upgrades to remain possible. Journal the deployment/buffer identities and signatures, reconcile interrupted submissions before retrying, and verify finalized loader ownership, full ProgramData hash, executable bytes and retained authority. This repository has no approved one-command Mainnet deployment yet.
8. **Initialize protocol state and deploy a private app.** Prepare, review and execute the required router/configuration, authority, pricing, recipient and lookup-table initialization against the deployed program. Verify every resulting account. Create a Mainnet-specific deployment manifest rather than running the Devnet release command. Build one immutable app image from the approved revision with Mainnet browser configuration; migrate the isolated database and use the same digest for the API and workers. Mount only the required production secrets. Start read-only with financial workers disabled. Verify `/api/health`, `/api/status`, `/api/readiness`, release identity, metadata and email delivery. Run online preflight after actual deployed program evidence is recorded.
9. **Run the capped private Mainnet canary.** Only after a reviewed activation mechanism exists, allow the approved test wallets and budget to exercise the acceptance plan: launch/burn/lock, buy/sell, collect/settle, all recipient categories, buyback/burn, community claims, developer unlock, admin withdrawal and restart recovery. Use ordinary production thresholds, never QA overrides. Reconcile every source debit, destination credit, fee, reserve and token supply change. Stop on unknown finality or any mismatch. Do not interpret read-only staging as a passed financial canary.
10. **Open public traffic gradually.** Approve the canary evidence and release packet, enable only reviewed routes and one lease-owning instance of each signing worker, then direct the public domain to the verified image. Monitor RPC errors/latency, WebSocket reconnects, worker freshness, pending obligations, duplicate attempts, treasury reserves and backups. On incident, disable writes/signers first and reconcile journals. Restore a prior app image only if compatible with the schema and on-chain state; never rewind the financial database to undo a finalized transfer.

Commands available now, from the repository root:

```sh
npm ci
npm run check
node --test tests/*.test.mjs
npm run build
npm run build:mainnet-preview
node scripts/mainnet-readiness-preflight.mjs --config /private/mainnet.env
```

The placeholder preflight exits nonzero by design. On Linux/WSL, with the checksum-verified Agave toolchain and its Solana Rust compiler available on `PATH`, a future candidate is built with:

```sh
export FUNDED_MAINNET_PROGRAM_ID=REPLACE_WITH_PRODUCTION_PROGRAM_PUBLIC_KEY
export FUNDED_MAINNET_FUNDED_MINT=REPLACE_WITH_MAINNET_FUNDED_MINT
export FUNDED_MAINNET_FUNDED_POOL=REPLACE_WITH_MAINNET_FUNDED_POOL
export CARGO_BUILD_SBF=/path/to/pinned/solana-release/bin/cargo-build-sbf
bash scripts/build-mainnet-contract.sh /path/to/fresh-candidate-directory
```

That command rejects placeholders and builds only. It does not load deployment signers or submit transactions. After deployment and complete isolated configuration, `node scripts/mainnet-readiness-preflight.mjs --config /private/mainnet.env --online` performs read-only checks; the current implementation still reports the unfinished application/evidence gates.

The Solana CLI's deployment and retained-authority behavior is documented in the [official deployment guide](https://solana.com/docs/programs/deploying). Operational backup, monitoring and recovery procedures are in the [operations runbook](operations-runbook.md).

The supported launch flow remains **Devnet only**; this does not establish that the public host is currently available. The separate Mainnet preview is read only. A Mainnet build must not enable coin creation by changing `VITE_ALLOW_MAINNET` alone: the launch client, metadata service, registration API, and fee distribution still contain Devnet-specific paths. The client launch function and registration API reject Mainnet until these dependencies are implemented and verified.

The subsequent deployment and fresh registered launch, escrow, creator payout and PumpSwap migration evidence are in [the November 5 release verification](devnet-release-verification-2026-11-05.md). Earlier incomplete-run statements below are historical and do not describe that later execution.

Developer lock options were subsequently deployed on Devnet: **6h, 12h, 24h and 48h**, with **12h default**. See [current lock behavior](launch-protections.md) and [deployment evidence](developer-lock-periods-2026-11-08.md). Earlier 12-hour receipt examples keep their original deadlines. This does not establish Mainnet readiness.

## Running read-only staging locally

From the release worktree, run `npm run build:mainnet-preview` and then `npm run start:mainnet-preview`. Open `http://127.0.0.1:4186`. The build uses a separate output directory and fixes the browser to read-only Mainnet with developer wallets disabled. The server binds to loopback and rejects submissions. It serves the bundled protocol split for display.

`GET /api/status` checks the exact Mainnet genesis and finalized slot through the official public RPC. For a dedicated provider, set `MAINNET_PREVIEW_RPC_URL_FILE` to the path of a server-side secret containing the rotated HTTPS URL before starting the preview. An unavailable or mismatched chain returns HTTP 503. Financial dashboards requiring an indexed database or payment API remain unavailable in this preview.

On November 6 the loopback preview passed desktop and mobile bootstrap and disabled-launch checks. The Devnet recheck verified prior finalized receipts for 33 SOL payments, four buyback burns, both paid launch tiers and one X payout using a test identity. The holder and buyback fixtures used the scoped QA conditions recorded in the [financial evidence](devnet-redis-financial-e2e-2026-11-01.json). These checks do not establish a fresh payment at ordinary thresholds or a live X OAuth sign-in.

Fresh November 6 Devnet tests also verified an external listing burn of 276.238524 $RICH, a 139-token Pro burn and a 277-token Premier burn. Both paid launches registered and locked the full 20% creator buy. The first Pro fixture selected the Standard agents and burned 139 tokens before registration rejected it. The launch builder now rejects this mismatch before wallet or RPC access. The original failed fixture remains unregistered. [Listing receipt](https://explorer.solana.com/tx/5CarxKDArowtHk1wpPAYz5Vsrfthf7Ku2X8GzQ3A9YHtpjrvg8JgW3uo841kJHHS8WD6FDTZfyFQXWLnuYDZYWXQ?cluster=devnet), [corrected Pro receipt](https://explorer.solana.com/tx/44Rjnd8gTeuRZNb8SDtS2EXKrxA2ir7QSfUVqjurUeVv7PRacqxNtfmWZ6cWvSbL3k5v64Jn2BMCqi8bPFV3RzvY?cluster=devnet), [Premier receipt](https://explorer.solana.com/tx/5pfLih9yAWRuRh2Wi2cR4mhhapUhngMEmw9ipupCkdkMfPK2HFXBjkRMZhjgj95JsEdjDDnw7pWEZVbU92tyztL1?cluster=devnet).

## Protected beneficiary routing and current evidence

The protected V3 implementation now commits beneficiary policy and rejects the older unprotected launch instruction. The earlier statement that all new Devnet launches are blocked is obsolete. See [protected V3 policy evidence](protected-v3-beneficiary-policy.md). This is Devnet engineering evidence, not an independent audit or Mainnet approval.

On 2026-11-05, the acceptance runner read the published Devnet V3 configuration and protected ProgramData hash `f0517fce9b8361be087456be2f5e5547af23b114ca1c0cf4ebaba5a42a8bd9ca`. The ephemeral test payer received 5 test SOL and finalized its fee-recipient funding transaction. The launch then stopped on a public RPC HTTP 429 before returning a launch receipt. No launch, buy/sell or payout success is claimed for that run. Its private key was process-memory-only and is no longer available after the process exited.

A subsequent Helius-backed run passed at 09:21 UTC. Mint `13oPpBSRMUDXNLczgAv4c23TaxLPccLUw1ML2jqKk7Z8` finalized protected V3 initialization, launch, buy, sell and creator-fee collection. Exact deltas at the isolated test fee recipient were 30,000 and 29,406 lamports; the router received 43,709 lamports from creator-fee collection. A separate read-only probe verified both finalized trade receipts, protected policy and custody of 30,000,000 community tokens. The live developer quote accepts exactly 200,000,000 of the 1,000,000,000 supply and rejects 20.000001%. At that observation, the standalone 20% developer quote was 69,415,809 lamports; the community reserve and other launch costs are additional.

The test mint is intentionally not registered in the public directory. Metadata publication, launch registration, creator escrow release after 12 hours, reward cycles, X/holder/referral/community payout, buyback and graduation are **not verified by this fresh execution**. Local tests of those modules are not substitutes for their full-duration on-chain journeys. The second payer used an ephemeral session with no private key saved. The session became inaccessible after the later task interruption; that payer cannot be reused. Its finalized receipts remain available.

Public transaction evidence:

- [Protected launch](https://explorer.solana.com/tx/42kUBB7g9qUGiPHmVUhTsC2Hmtpe61L4W6ycUvdDvhWwQMgYYX8YRKHz7dQ3ksDH5X4yMP9hrxiwE3mdzdgJhLrC?cluster=devnet)
- [Buy](https://explorer.solana.com/tx/2hddBWBrRoA3bok4UFjsDgConPnUfh6FRQkPaUSggpGJoR1NKt4E5iSJhyKfgzmRJFK3r9ggprvYAZLs8hWCoFt5?cluster=devnet)
- [Sell](https://explorer.solana.com/tx/5rs1F14Yp98GzTUVut92A6NbbNEdnebwCkLssasps7jbtn6FKT6KYn5yA6KvMgMiUvtSmA77iDZK7qxt92gWfM9C?cluster=devnet)
- [Creator-fee collection](https://explorer.solana.com/tx/2wxkbLP44FVhN2e9FZRUkVsnpTg7L5d3hzrqAyHk21B9jFvMtebxUJ7jP5EHNT8t8JXFJtKFMK5XGgJ8shjfkk8M?cluster=devnet)


## Preparation implemented, activation still blocked

The preparation branch fixes the full Mainnet genesis identity, binds new launch service quotes and signed metadata to their selected network, requires durable content-addressed Mainnet metadata, and bounds browser RPC read concurrency. Devnet legacy metadata signatures and short-lived unbound quotes remain compatible. Mainnet launch, registration, indexing and financial workers retain their existing write guards.

The read-only preflight checks cluster alignment, disabled development wallets and write flags, the 1% configured fee and recipient, dedicated RPC, separate databases and durable storage. With `MAINNET_PROGRAM_LAYOUT=merged-v3`, the V3 router and developer escrow must share one program ID, full ProgramData hash and reviewed authority; a separate legacy router is not required. The previous three-role inventory remains supported for existing configurations. Online verification also reads the staging deployment service-fee endpoint and checks its saved 100-bps policy, recipient, network and policy hash. It checks finalized executable accounts, full ProgramData hashes and the reviewed authority for every role, reading a shared program only once. Different credentials for the same database do not count as isolation. A passing configuration or program inventory still returns `ready:false`; it does not approve application or custody behavior.

Use [the staging template](../config/mainnet-staging.example) only as an inventory checklist. Its placeholder IDs and credentials deliberately fail readiness. Mainnet routing still needs implementation against the approved deployment inventory, then full Devnet verification and a separately approved capped canary.

## Verification and source delivery, 2026-11-05

The preparation work is isolated on `codex/mainnet-preparation`, rebased onto UI release `b2d8e081`. It has not been merged into `main`, pushed, or deployed by this task. The mainnet write guards remain enabled. Public Devnet service recovered after a temporary all-container shutdown; subsequent external reads returned healthy `/api/health`, Devnet `/api/service-fees` with `tradeBps:100`, and an enabled Devnet V3 launch configuration. These endpoint checks are availability/configuration evidence only.

Before integration, the complete unit run recorded 1,814 passes, zero failures and 21 skips; three additional acceptance-session replay-guard tests passed. Disposable PostgreSQL and Redis integration checks passed, and those containers were removed. The broad 1,051-case browser run was interrupted after case 457 started, with failures in legacy navigation, retired Home controls, layout expectations and other UI cases. One trace failure resulted from overlapping output directories; subsequent runs use a separate output directory. That broad run is **not passed** and is not full UI certification. After integration and the worker-health fix, the full unit suite passed 1,823 tests with zero failures and 21 skips (1,844 total). JavaScript syntax checks, source-size budgets and the production build passed. The skipped platform/integration cases are not passes; PostgreSQL and Redis were exercised separately as described above. The affected browser pass recorded 125 passes and 10 failures, followed by targeted corrections and reruns. The final targeted rerun passed all 14 cases, covering all 10 failures: the 135 distinct affected cases have now passed across the completed runs. These are local browser checks with mocked API/RPC data, not additional on-chain evidence. The full 1,051-case suite has not been cleared on the final preparation branch, and the remaining financial journeys above still require finalized evidence.

Concurrent worker health writers now use process-specific temporary files, preventing a rename race observed in the real worker shutdown fixture. That fixture passed after the fix, as did the complete unit rerun. Vite also ignores temporary release fixtures under `.secrets`, preventing test HTML from reloading active browser pages.

The ephemeral acceptance session now also blocks another run after an exception or incomplete result, because evidence persistence can fail after a transaction was broadcast. It never treats an unknown outcome as permission to launch again.

## Helius setup

Helius is the selected RPC provider. Its [data quickstart](https://www.helius.dev/docs/getting-data/quickstart) documents authenticated RPC access; follow its [API-key guidance](https://www.helius.dev/docs/rpc/protect-your-keys). Use separate Devnet and Mainnet credentials/endpoints. Keep the full endpoint in a server-side secret, never a `VITE_*` variable or browser bundle.

For the existing Devnet deployment, update the RPC gateway upstream secret referenced by `FUNDED_RPC_UPSTREAM_URL_FILE` to the Helius **Devnet** URL. The gateway checks the exact Devnet genesis before serving requests and retains its existing pacing. Do not configure its current Devnet-only runtime with a Mainnet endpoint. A local acceptance run may load the Devnet URL from a private file in memory and pass it as `rpcUrl`; report only the URL origin. After configuration, validate genesis, program-byte reads, finalized status polling, 429 behavior and fee/state deltas. The supplied Helius credential was verified against Devnet and used only in the live test process. It has not been installed into deployment configuration; rotate the credential shared in chat before saving its replacement in the secret store.

The user confirmed on 2026-11-05 that an independent contract/custody audit and dedicated Mainnet deployment are not yet available. Those remain external release requirements.

## Deployment verification

The platform trading fee defaults to **100 bps (1%) on buys and sells** on both networks. `/api/service-fees` reports the configured server network, and the client accepts a policy only for its selected network. Each deployment's saved service-fee policy takes precedence over the default; an existing Mainnet deployment must have `policy.tradeBps: 100` in its own store. The creator launch-buy limit remains **20% of total supply**. These fee settings do not enable Mainnet trading or launching; live Mainnet application requires the target deployment and its production configuration.

Historical availability checks and Devnet receipts do not establish current public access or Mainnet readiness. Match the running image and build identity to the intended committed revision, then verify public HTTPS health, assets, deep links and required Devnet routes from an external client. A deployment record or local Docker success alone does not establish public access. Follow the [release, incident and recovery runbook](operations-runbook.md) for current evidence requirements.

The remaining Mainnet gates are concrete: an independently reviewed and deployed fee router; dedicated audited buyback custody rather than the Devnet executor; a verified community migration snapshot and payable cycle; and Mainnet proof for X, creator, holder, referral, and fee routing with separate credentials and infrastructure. Canonical committed Devnet source and a transferable deployment bundle are now available; the earlier mixed-checkout reconciliation is no longer an outstanding source-delivery gate. That delivery is not an independently reviewed Mainnet release. A Mainnet artifact still requires the exact source revision, immutable application and contract digests, separate Mainnet configuration, and evidence that every gate below has passed.

## Program deployment cost

Program rent scales with the bytes deployed. On 2026-11-07 Devnet and Mainnet both charged 5,080 lamports per byte (`getMinimumBalanceForRentExemption(0)` = 650,240). Estimate any build offline, without keys or cluster access:

```sh
node scripts/estimate-program-deploy-cost.mjs contracts/funded-fee-router/target/deploy/mainnet-candidate/funded_fee_router.so
```

The intended Mainnet feature set is V3. The historical cost-reference artifact below was compiled with `devnet-v3-program`; a dedicated `mainnet-v3-program` feature now requires an explicit production identity. See [the 8 November preparation record](mainnet-preparation-2026-11-08.md) for current checks and remaining blockers. The default build is the legacy router (V1 settlement and migration instructions) and is not a feature-equivalent Mainnet candidate. Since the developer escrow was merged into the router (`cc1901b6`), the intended fresh Mainnet layout needs one program; the separate token-lock program remains available for existing Devnet locks. Production identity, network routes and custody still require review before any candidate is deployable.

Sizes from the pinned toolchain (Rust 1.97.1, Agave 4.1.2, platform-tools v1.54), with merged candidates reproduced at `e3d08082`. Mainnet rent was read at finalized slot 466422929 on 2026-11-07 at 07:09 UTC (14:09 Bangkok). Figures assume exact binary-length allocation:

| Mainnet plan | Executable | Locked rent | Suggested deployment wallet |
| --- | --- | --- | --- |
| V3 router plus separate token lock (before the escrow merge) | 1,043,256 + 208,280 bytes | 6.361227 SOL | Historical comparison |
| V3 router with merged escrow | 1,093,784 bytes | 5.558135 SOL | 6 SOL |
| V3 router, `opt-level = "z"` and stripped | 898,328 bytes | 4.565218 SOL | 5 SOL |

The size-optimized build passed the same compiled-bytecode tests as the standard build (3 account-setup and 5 developer-escrow VM tests) in [successful CI run 42349176721](https://github.com/roger-morrision/funded.app/actions/runs/42349176721). The downloaded artifact and independent local build both hash to `d1c94867f03027920363f8cb74497aa6c97dcda661b0494c2af98d243a874475`. That historical CI run built it as `target/deploy/mainnet-candidate/funded_fee_router.so`. Current CI separately checks `mainnet-build-check` with a test-only identity; the candidate manifest does not alter the deployed Devnet trust commitment. Size optimization can raise compute usage; confirm full financial-path compute budgets on the reviewed candidate before deployment. The legacy fee router deployed on Devnet (`FUNDED_FEE_ROUTER_PROGRAM_ID`) is not part of a V3-only Mainnet.

The optimized merged candidate saves approximately 1.796 SOL (28.2%) in locked rent versus the actual pre-merge pair, including 0.993 SOL from size optimization alone. Earlier 9-12 SOL funding figures included an extra full buffer allowance. A fresh Loader-v3 deployment drains the buffer to the same payer before funding ProgramData, so that buffer is not an additional simultaneous rent requirement. This is confirmed by the [pinned loader implementation](https://github.com/anza-xyz/agave/blob/v4.1.2/programs/bpf_loader/src/lib.rs#L260-L280) and [CLI deployment flow](https://github.com/anza-xyz/agave/blob/v4.1.2/cli/src/program.rs#L2433-L2551). Upgrades, different payers and abandoned buffers need separate funding analysis.

The 5 SOL suggestion allows 0.025 SOL for fees and 0.25 SOL margin above rent, rounded up to a whole SOL. Estimated base fees are 0.01002 SOL for roughly 999 writes with two signatures plus setup/finalization; actual messages, priority fees and retries determine the final amount. This is program deployment funding only. It excludes liquidity, configuration/state PDAs, token accounts, lookup tables, canary and operating balances, hosting and independent review.

The [deployment inventory](../config/mainnet-deployment-plan.json) records missing production inputs and the approval/verification sequence. The [dated machine-readable quote](mainnet-deployment-cost-2026-11-07.json) records live rent and both candidate hashes. Reproduce it against the downloaded CI artifact directory:

```sh
node scripts/prepare-mainnet-deployment.mjs --artifact-dir PATH_TO_CI_ARTIFACT --online --output tmp/mainnet-cost.json
```

This tool verifies ELF size/hash, Mainnet genesis and finalized rent using read-only RPC. It never loads signers or submits transactions and always reports `ready:false`. Without `--online`, rent is explicitly labelled an offline assumption. Missing production inputs are authority, program ID, app origin, payer signer reference, isolated RPC/database/storage references, fee recipient and funded mint. Do not put private keys or credential values in this inventory.

Cheapest safe procedure:

1. Deploy the exact reviewed binary once; every redeploy or upgrade writes another full-size buffer.
2. Set `--max-len` to the binary size. Rent is charged on the allocation, so a 2× allocation doubles it; grow later with `solana program extend` when an upgrade needs room.
3. Fund locked rent plus fees and a retry margin for a fresh same-payer deployment. Journal the exact buffer address and signatures; after interruption, reconcile finalized state before resuming or closing that specific owned buffer. Do not close all buffers indiscriminately.
4. Use the isolated production RPC for the upload. Refresh fees against the final messages and signer count; set any priority fee within the approved spend cap.
5. Reclaim operating rent where the program allows: deactivate and close unused address lookup tables, and close emptied per-mint token accounts and vaults.

## Required before enabling Mainnet

1. Deploy and independently review the fee-router program on Mainnet. Verify its program ID, authority, mint-specific PDA, Pump creator-fee route, and recovery path against Mainnet accounts.
2. Configure separate Mainnet RPC, database, signing roles, funded token mint, and metadata/image storage. Keep Devnet and Mainnet records and credentials isolated.
3. Replace Devnet metadata URLs and signing statements with network-specific versions. Confirm images and metadata remain available after launch.
4. Make launch simulation, cost review, transaction signing, confirmation, and mint/fee-owner verification use the selected network consistently. Never reuse a Devnet quote or blockhash on Mainnet.
5. Verify fee collection, allocation, creator/holder/X/referral/community/buyback settlement, indexing, and claim receipt reconciliation with the Mainnet router before promising rewards.
6. Run wallet and backend tests against a dedicated Mainnet canary with a capped spend. Check finalized transactions, registered mint and metadata, exact fee owner, and expected balance/state changes. Document rollback and incident handling.

Only after every gate passes should the Mainnet launch guard in `app.js`, `launch-flow.js`, and `server/index.mjs` be lifted together. Keep the Devnet launch available throughout the rollout.
