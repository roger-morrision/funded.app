# Agency and legacy integration checkpoint — 2026-10-19

This is a local integration checkpoint. It is not a deployment or a claim that agency execution is active.

**Subsequent referral amendment:** the approved new-launch levels are now **0.6% / 0.25% / 0.15% of gross collected creator fees**, totaling 1%. This supersedes the 0.6667% / 0.2% / 0.1333% configuration recorded below. The candidate configuration, API presentation, UI and test fixtures use the revised levels; the earlier checkpoint results below describe their original revision. Activation remains pending, and existing mint policies retain their recorded rates.

## Git and observed runtime

| Item | Classification | Evidence |
| --- | --- | --- |
| Finalized settlement-window rollout | Included | `620aff2096abaac328e6009267703163ac627e6e`, integrated by `adcdbac`; pagination/restart/CAS tests retained alongside frozen-ranking additive reconciliation. |
| Protected residual execution | Included locally | `6d3272b` adds separate audited residual withdrawal/source identities, creator signing, receipt recovery and holder/X enrollment. No live supplemental transfer claimed. |
| Legacy preservation and PostgreSQL audit hashes | Included locally | `459a6d8ca0ae3a515e6f2bd39ae8ea12e8d93a34`; new canonical hashes tolerate jsonb object ordering without altering historical bonus hashes. |
| Token trade-panel wallet action | Included locally | Deployed source `004bf1c9592ed3b8298470ed5ebf8434e04f0401`, integrated by `037d045d969a8d8b584b4ab0612c8f5feb97ba44`. All seven product files match the source exactly. Four mobile/desktop chooser cases pass after correcting the required fee-policy fixture and identifying read-only RPC requests by pathname and method. |
| Agency contract and execution adapters | Local candidate; activation blocked | New separate eight-category policy/config/claim accounts preserve old V3 layouts. Normal launch, admin configuration, worker deployment and live agency acceptance still require completion. |

Refreshed `origin/main` remained `620aff2`. The public `/api/status` reported build **004bf1c9592ed3b8298470ed5ebf8434e04f0401**, Devnet, operational, and `settlementVerified:true` with **31/31** recorded collections verified. That does not prove deployment of this task's residual or agency code.

## Local agency implementation

- Fixed creator 80%; protocol categories: Operations 8%, referrals 1%, Daily bonus 4%, FUNDED buyback 5%, agency 2%. Referral levels remain 0.6667/0.2/0.1333% of gross.
- Separate immutable agency mint policy copies the future-mint configuration revision, billing recipient, creator-directed shares and selected-agent bitmap. Existing seven-category V3 accounts are unchanged.
- Equal cumulative agent sub-budgets, no-selection reserve, one-time own-coin completion flags, and no generic withdrawal from the agency category.
- Promotion billing binds exact X post ID, delivery hash, monotonic sequence, recipient, amount and 24-hour cadence. The hash is an authority attestation; it is not an on-chain X oracle.
- Own-coin buy/burn binds selected agent, source mint, bounded budget, fresh observation slot/time/hash and milestone. Strict PumpSwap custody, exact-quote CPI, BurnChecked and supply-delta checks remain atomic. USD is an off-chain authority attestation, not a contract USD oracle.
- Browser-safe builders/decoders and server settlement/protected disbursement proofs support the signed eight-category policy. Existing FUNDED buyback stays category six.
- Execution preflight independently verifies reviewed program bytes, Devnet genesis, current authority, actual Pump launch, finalized collections, eight-category settlements, cumulative counters and vault rent/custody. DB allocations and donations cannot establish fee funding.
- Durable promotion intents retain exact text, sequence and budget across restarts. X delivery must independently match the configured account, full text with provider-expanded t.co links, and timestamp before billing.
- Durable transaction journals save signed bytes before broadcast, preserve the payer's 3 SOL reserve, and reconcile ambiguous outcomes using the same signature. A timeout cannot authorize a fresh payment or post. Finalized receipts and balance changes are required before success is stored.
- Milestone observations use one finalized bank snapshot for the canonical own-coin pool, completed Pump curve, mint supply and both reserves, plus a fresh fetched SOL/USD reference. Server-configured USD prices cannot qualify. Integer arithmetic never rounds a below-threshold cap upward. Purchases retain the existing liquidity clip and 1% slippage guard.
- Generic X dispatch excludes agency events; they require the dedicated funded-intent preflight. The dedicated worker, normal browser launch/estimate, signed selection metadata, immutable registration verification, timestamped public budget/history summary, and disabled-by-default Compose profile are now implemented locally.
- Normal launch activation requires reviewed program bytes, the on-chain configuration revision, matching published fee policy, a fresh exact-build worker heartbeat, and an explicit acceptance switch. Merely enabling an environment flag cannot supply the chain/configuration proofs. Every new launch uses the agency policy after activation, including no-team launches.
- Worker readiness and execution success are distinct. Missing canonical migration remains pending; unexpected execution failures degrade readiness. Public summaries refuse stale/missing snapshots and never expose signed journal bytes. History labels worker-verified finalized receipts and does not equate rendering with a new payment.
- Registration now saves the verified per-launch protocol split in its fee-distribution metadata rather than rebuilding the static default. Signed marketing selections and revision changes invalidate the launch statement and reviewed estimate.

## Contract evidence and payer

Devnet program: `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`.

Built SBF: **961,760 bytes**, SHA-256 **3ba48566fd36814d9b2e8c834b3544da68ab822309e8575826d33e7c87fda9d0**. Built with platform-tools v1.54 and `devnet-v3-program`. ProgramData's loader header/slot is separate from the reviewed binary hash; execution also requires the exact finalized full-account hash and zero-only trailing padding.

Sixteen local VM regressions passed across agency, community, policy, historical recovery, protected beneficiary, reward and reserve suites. Agency buyback proof tests use mocked RPC/CPI evidence; no real own-coin milestone purchase or burn was executed.

Latest read-only payer check: **6.352742082 SOL** at `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`. Estimated requirement **8.8399198 SOL**: refundable upload rent 4.886579, program growth 0.9233408, protected reserve 3, other-cost budget 0.03. The user said they will fund to 9 SOL; that funding had not appeared. Recalculate before any extension/upgrade. No upgrade was submitted.

## Legacy preservation evidence

Read-only finalized audit for `EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc` confirmed exactly two used original allocations with cumulative differences `[0,+1,-1]` lamports for creator/holder/X. Preservation review hash:

`89bcce2aeb3e45155eb0cdd0676bed4a35813e0222a00f7ba5f95f737accd140`

The approved rule keeps original funding and receipts. This plan permits no corrective transfer, clawback, or cross-recipient reassignment. No live admin approval or ledger update was performed. Ordinary unpaid original obligations still require their original authorization; funding a reward vault is not a holder/X recipient payment.

## Test evidence

| Check | Result | Scope |
| --- | --- | --- |
| Full unit suite | 1,031 passed; 10 existing skips; zero failures | Synthetic and mocked chain fixtures included; not live financial acceptance. |
| Critical gates | Passed | Chat, backend hardening, production policies, fee policy, receipt evidence. |
| Production build | Passed | Rebuilt after integrating the trade-panel source; existing chunk warning retained. |
| Admin/Daily bonus/agency/launch-package/wallet browser | 25 passed | Production bundle, mocked APIs and wallet providers. Includes timestamped active budget/receipt fixture and mobile/desktop wallet chooser; zero real wallet signatures or financial writes. |
| Agency Compose profile | Validated | Exact-release stack parsed with no secret output and no service startup. |
| PostgreSQL durability | 8 checks passed | Real isolated PostgreSQL, mocked RPC; promotion intent, signed journal and finalized-proof persistence verified across reconnect. Zero network transactions/X posts. Temporary container removed after exact-ID verification. |
| Audit hash jsonb roundtrip | Passed | Actual read-only PostgreSQL SELECT; reordered keys preserve audit identity and tampered amount is rejected. |
| Legacy chain audit | Two exact preservation sources verified | Read-only finalized RPC; zero DB writes or submitted transactions. |

Evidence is ignored under `tmp/agency-*` and `data/qa-evidence/remaining-issues-20261019/`. Generated binaries/keypairs, exports, secrets and unrelated `docs/qa-dev-loop/` reports must not be staged.

## Release gates still open

1. Bootstrap and verify the reviewed on-chain agency configuration, then complete the authority-approved admin future-mint config update; the generic off-chain editor currently rejects agency activation. Keep old policy snapshots intact.
2. Deploy and verify the normal launch/worker/public-summary integration. The source and Compose profile are implemented; no running agency worker or enabled normal flow is claimed.
3. Verify full-size transaction/lookup tables and actual current-source agency settlement, X publication/billing and each canonical own-coin milestone execution on Devnet. No synthetic pool or configured USD price may be reported as a real qualifying migration/market.
4. Apply the live audited legacy-preservation approval and verify reconciliation after deploying the tested recovery candidate. Apply additive bonus corrections only to real eligible unpaid evidence, preserving paid rankings and receipts.
5. Fund the QA payer, recalculate costs, then upgrade only after the source/runtime cutover and tests are ready. Confirm new ProgramData bytes and exact app image SHA. Push/deploy the complete tested integration and verify affected live flows.

No source push, new program upgrade, live agency post/billing, milestone buy/burn, or live residual payment is claimed by this checkpoint.
