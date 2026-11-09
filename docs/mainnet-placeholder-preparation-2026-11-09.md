# Mainnet placeholder preparation — 9 November 2026

**Mainnet remains disabled.** This pass changes local preparation code and tests; it does not deploy a Mainnet program, create production wallets, spend Mainnet SOL or activate a production signer. Unknown identities remain empty. The committed production release manifest is still unreviewed.

## Completed implementation

| Area | Result |
| --- | --- |
| Isolated startup | Mainnet cannot implicitly import `.env.local` or expand local secret files. Explicit staging configuration rejects transaction-key settings, runtime hooks and enabled financial flags before reading referenced secrets. |
| Staging API | Added explicit loading of a dedicated internal API token and a preflight check for it. The staging runner still requires matching browser/server public identities and an isolated database. |
| Key isolation | Mainnet fee-service accessors, launch-readiness checks, community indexing and API worker startup do not load transaction keys. HTTP/RPC/WebSocket write barriers remain intact even if someone supplies an enable flag directly. |
| Fee routing | Collection and referral execution/reconciliation verify RPC genesis before state reads or transfers. Collection readiness and finality proofs receive the selected network explicitly. |
| Price review | The reviewer can validate Mainnet release identity, assets, authority and genesis against the committed reviewed manifest. The signing service remains Devnet-only. Its launcher validates public configuration, chain and deployed program before loading its private key; bootstrap errors do not expose RPC credentials. |
| Market planning | Preparation and acceptance requirements cover the canonical Pump curve before migration and the canonical PumpSwap pool after migration. A derived future pool address is not treated as live liquidity. |
| Evidence reporting | The launch packet now recognizes the newer financial-step evidence schema, preserves later failed steps and labels those results partial/historical. It never converts them into current-release acceptance. |
| Funding planning | Unknown initialization, token-launch/liquidity and canary costs remain missing. The planner distinguishes the approved spending cap from the existing 3 SOL operating reserve and never grants deployment authorization. |
| Contract candidate | Rebuilt and reproduced the Mainnet feature with public test identities. Corrected the stale candidate record from 896,304 to 915,704 bytes after verification. The Devnet runtime commitment and production approval manifest were not changed. |

## Verification

Machine-readable evidence: [preparation results](evidence/mainnet-placeholder-preparation-2026-11-09.json).

- **382 JavaScript tests passed**, including actual local HTTP/WebSocket write-block tests and mocked network/custody/recovery cases. This count includes concurrent app changes present at the time of the run.
- **11 Rust tests passed**: one native curve-address regression and ten compiled-bytecode custody/community/developer-lock tests. These are offline VM tests, not live Mainnet acceptance.
- Fourteen invalid contract build configurations were rejected; an explicit public fixture was accepted.
- Two Mainnet-feature builds produced identical SHA-256 `1d13df0ee7b5dba55701a304ab9b975f426128c4eeadc5745a93d86abafaf135` (915,704 bytes). Both candidate verification commands passed; Devnet runtime trust is unchanged.
- Application and read-only Mainnet preview builds passed. Vite still reports a large application chunk; this pass does not claim a performance audit.
- Syntax and source-size checks passed. See the evidence file for the final file counts and log hashes.
- The planning packet remains `no-go`, with `ready: false` and `mainnetActivationAuthorized: false`.

The actual Devnet pre/post-migration fee-vault proofs remain in [the lifecycle evidence](evidence/rich-devnet-fee-vault-lifecycle-2026-11-09.json). They were not rerun or relabeled as Mainnet results in this pass. The isolated fixture is distinct from the revenue-funded production worker.

## Updated cost check

The configured Mainnet RPC returned finalized slot **467282716** on 9 November at **10:23:58 UTC**. Exact-length program plus ProgramData rent for the **test-only** 915,704-byte build was **4.653488280 SOL**. With the existing 0.025 SOL fee allowance and 0.25 SOL deployment margin, the provisional spend estimate is **4.928488280 SOL**, leaving **0.071511720 SOL** under the approved **5 SOL** cap before unknown setup, launch/liquidity and canary costs.

The worker's **3 SOL reserve is separate available capital, not additional authorized spending**. Including it brings provisional required funding to at least **7.928488280 SOL**, before those unknown costs. No payer balance or final transaction fees are verified by this quote. Actual production identities change the final artifact; refresh the full estimate after the final build. Do not increase the spending cap or weaken the reserve automatically.

## Still required before production activation

These are not reported as completed by placeholder configuration or offline tests:

1. Select the real Mainnet RICH mint/launch (or authorize its creation), payer and signing method, production treasury/automation/price-signer custody, and isolated database/cache/metadata/backup setup. Hosting access, richpad.fun TLS, admin/upgrade wallet, RPC choices and the 5 SOL cap are already recorded; they do not need to be supplied again.
2. Complete and verify the production entry-point configuration for launch registration, metadata, fee collection, payouts, holder/Daily bonus workers, X claims and community delivery. Their current activation barriers remain deliberately closed. The network-aware helper tests do not certify the entire production business flow.
3. Finish current-release live financial acceptance: full holder/Daily bonus delivery, real X identity/payment if enabled, community migration delivery, paid-launch cancellation/recovery, remaining protocol/agency paths and worker restart reconciliation. If X remains suspended/unconfigured, keep that feature disabled.
4. Complete the real 48-hour lock release and duplicate rejection **after 10 November 2026, 09:23:54 Bangkok**. VM tests already exercise all four lock periods; they do not replace this real elapsed-time test.
5. Freeze the exact production application and contract, obtain independent contract/custody review, prove backup restoration and restart recovery, and approve the exact bounded deployment/canary. Only then consider a separately reviewed activation change.

Owner inputs may remain placeholders now. Before activation, the owner will also need to provide the operator's legal/support/privacy details, a retained Devnet hostname and off-host backup destination, and an independent review contact/report. A separate signer process under the same operator does not constitute external review.

## Repeat the local checks

```powershell
node --test tests/*.test.mjs
npm run check
npm run build
npm run build:mainnet-preview
node scripts/mainnet-launch-packet.mjs --config config/mainnet-staging.example --evidence docs/evidence/richpad-acceptance-2026-11-09.json --output tmp/mainnet-placeholder-packet-new.json
```

The final planning command intentionally exits with code 1 because it cannot approve activation. Use a fresh output filename. Compiled-contract testing uses the pinned Agave 4.1.2 archive/platform-tools v1.54 for SBF and Rust 1.97.1 for host tests, with the public identities in `config/contract-build-candidates.json`; never reuse those fixture identities for production.
