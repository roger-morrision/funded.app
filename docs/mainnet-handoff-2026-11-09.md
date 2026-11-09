# Mainnet handoff — placeholders first

Latest implementation and test results: [placeholder preparation update](mainnet-placeholder-preparation-2026-11-09.md). Earlier test counts and release revisions below are historical, not current deployment attestations.

Status: **NO-GO**. The user reconfirmed “PLACE HOLDER FIRST” on 9 November 2026. Keep unknown production values empty; do not generate funded accounts, deploy a program, submit transactions, or enable financial workers to fill those gaps. Preparation is not a completed launch.

## Already supplied

| Decision | Recorded value |
| --- | --- |
| Admin and upgrade authority | `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC` |
| Total SOL spending limit | **5 SOL**, including deployment and trial; do not silently increase it |
| Primary / backup RPC | Free Helius / public Solana Mainnet RPC |
| Indexed market fallback | Birdeye; its existing key stays server-side |
| Intended public site | richpad.fun; preserve a separate Devnet environment |
| Current activation | Disabled; read-only preparation |
| RICH launch venue | Pump.fun; actual Mainnet mint and pool remain placeholders until verified |

## Inputs the owner will need to supply

No immediate response is required while placeholders are requested. Provide public addresses, account access through the appropriate service, or private **file references**. Never paste wallet keys, seed phrases, passwords or API tokens into this document or chat.

| Input | Exact information needed | Work it unlocks |
| --- | --- | --- |
| Mainnet $RICH assets | Supply the actual mint and launch receipt, or request creation with a selected payer and budget. Before migration use the verified canonical Pump curve; after migration use the reviewed SOL/RICH PumpSwap pool and verified reserves. The future canonical pool identity can be recorded before its account exists. | Bind production assets to final bytecode and verify both market routes |
| Production isolation | Remote hosting access and richpad.fun TLS already exist. Select isolated Mainnet services on that host or a separate host, the retained Devnet hostname, and an off-host backup destination. | Provision separate production database/cache/storage and prove restoration without copying Devnet financial state |
| Metadata storage | Production Pinata credential-file reference and account/namespace to use. | Durable logo/banner/metadata storage and retrieval verification |
| Deployment payer | Public payer address plus supported signing method or protected signer-file reference. Confirm whether the recorded admin wallet is also the payer. | Exact deployment messages, signatures and capped canary; authority address alone is not signing access |
| Treasury and automation custody | Public recipients for operations, trade fees, boost payments and revenue, or a decision to create separate production wallets. Provide secure signer-service/file references for automation and the independently controlled price-attestation role. | Worker configuration, withdrawals, reward execution and verified buybacks |
| Admin email and X claims | Admin email, verified sender and mail credential reference; production X OAuth/lookup credential references and callback-domain setup. A person must complete the real X identity/wallet verification. | OTP-protected withdrawals and identity-bound X claims. Manual promotional posting is separate from X payout verification. |
| Operator and review | Operator legal name, address/jurisdiction, support/privacy contact; independent contract/custody reviewer and review-report reference when available. | Replace production terms placeholders and review the final source/binary/custody setup |

The program ID, deployment hashes, lookup tables, build revision, database names and validation receipts are implementation outputs. The owner does not need to invent these values. A final review can only reference the actual production build, not today's Devnet binary.

## Work still required from implementation and verification

| Gate | Current state / next action |
| --- | --- |
| Mainnet financial integration | Launch readiness and registration, X capability, fee collector, holder/daily-bonus workers and community delivery still contain Devnet-only guards. Complete their selected-network configuration and reviewed-program checks before considering activation. Setting a flag cannot replace this work. |
| Exact release | Boost recovery and mobile-menu fixes are included in committed Devnet release `df58498490d8f2b208fd923618c44b7ce3fc7928`. Freeze the final production application release and reproduce its program binary with actual program, mint and pool identities. Devnet deployment does not certify Mainnet acceptance. |
| Financial acceptance | Revalidate all 13 cases in `config/mainnet-acceptance-plan.json` against that release. Historical receipts and mocked tests are not current-release acceptance. Remaining cases include full holder delivery, X identity/payment, protocol distributions, buyback/burn, community claims and interrupted-transaction recovery. |
| Independent price signer | A separate Devnet signer service is configured and activated. Fee-vault curve and post-migration buy/burn proofs are recorded. Production still needs its own key custody and reviewed allowlist; the existing service refuses Mainnet before loading private keys. Separate processes under the same operator are not an independent external audit. |
| 48-hour lock | Early release is rejected and the vault balance is unchanged. The lock matures **10 November 2026, 09:23:54 Bangkok**. After that, verify finalized release to the original beneficiary and duplicate rejection. Do not shorten the deadline to pass the test. |
| Infrastructure | Verify isolated database/cache, backups **and restoration**, metadata retrieval, secret permissions, rate limits, health monitoring, and restart reconciliation. |
| Cost and funding | Refresh rent for the final reviewed binary and estimate all setup, transaction, liquidity, operating and canary costs. Keep their total within 5 SOL. Check the selected payer's live balance only after the payer is identified. |
| Deployment and canary | Present the exact artifact, identities, transactions and capped spend. Verify finalized deployed bytes and authority, then every canary balance/state delta. Enable public writes only after acceptance. |

The earlier 900,144-byte **reference** binary rent was 4.574443480 SOL, leaving 0.425556520 SOL before other costs. This is not a final quote or proof that 5 SOL covers the full launch. A fresh Loader-v3 deployment reuses buffer lamports; do not count the same buffer rent twice.

## Completed in this pass

- Bound the browser release artifact to its public program, mint, pool, trade-fee recipient, fee rate and API origin. Read-only backend staging rejects missing/mismatched identity, even when both builds say Mainnet.
- Added preflight rejection for missing/mismatched pools, program/mint/pool address collisions and cross-origin browser API configuration.
- Fixed the preview's explicit `loadEnv` call so `.env.local` cannot supply Devnet identities to a Mainnet preview artifact. Rebuilt and checked that its unconfigured identities are empty.
- Rechecked live Helius and public Mainnet RPC with a simulated primary quota rejection. Both returned Mainnet slots; submission remained blocked. No Mainnet transaction was submitted.
- Ran 294 tests successfully (local/mocked financial checks), built the read-only Mainnet preview, and refreshed the planning packet. The packet remains NO-GO with 21 missing production inventory fields and an unreviewed release. Syntax checks passed for 962 JavaScript files and size budgets for 1,187 maintained code files.

The preview build is only a browser/network preview with empty production identities. It cannot pass full backend staging or be treated as a production financial environment.

## Reproducible checks

```powershell
node --test --test-concurrency=2 tests/*.test.mjs
npm run check
npm run build:mainnet-preview
node scripts/mainnet-launch-packet.mjs --config .secrets/mainnet-staging.env --evidence docs/evidence/smaller-devnet-release-2026-11-09.json --output tmp/mainnet-owner-review.json
```

Use a new output filename for each planning packet. Its exit code 1 is the expected NO-GO result; retain the original exit status rather than interpreting a subsequent successful file read as readiness. See `docs/evidence/mainnet-handoff-2026-11-09.json` for this pass's evidence.

For full read-only backend staging, rebuild with the filled public identities and `VITE_API_BASE_URL=/` in an isolated checkout/image, then run `scripts/start-mainnet-staging.mjs --config PRIVATE_FILE`. Older browser artifacts without the new identity fields must be rebuilt. Runtime secret changes do not update browser-embedded values.

Rollback: disable writes and stop financial workers, retain all pending transaction journals and obligations, and reconcile submitted signatures before any retry. Do not automatically downgrade the program or discard financial records.
