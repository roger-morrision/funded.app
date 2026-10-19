# Remaining-issue implementation progress — 19 October 2026

This is an incomplete candidate, based on `4dafc67351dda9ddfa907d3ad3aea194512707c9`. It is not an agency activation or a completed financial-recovery release. No new contract, agency post, purchase, burn or residual transfer was submitted by this work.

## Approved decisions

- New bonus windows use finalized settlement time. Later settlements qualify in their applicable later window; existing paid rankings remain frozen.
- Reconciliation preserves existing paid receipts and recipient amounts. Negative, missing or conflicting residuals fail closed.
- Agent 1 may post at most once per coin per 24 hours. Billing follows verified X delivery; an uncertain or unbilled prior delivery must be reconciled before another promotion.

## Checklist and evidence

| Item | Source evidence | Candidate behavior | Verification / remaining work |
| --- | --- | --- | --- |
| FQA-002: one unsettled collection blocks unrelated bonuses | Baseline `server/daily-bonus-index.mjs` indexed collection-time sources and waited for all settlements | Separate settlement-time index; discovers actual successful settlement instructions, independently verifies collection and settlement, attributes only that finalized window, exposes pending sources | Mocked mixed-source, restart, unknown-settlement, chronology, exact-time and boundary tests pass. Live read-only index for `7YPFkW…b8x7` verified one settlement and two trades in 17 RPC calls. Already assigned funding was excluded. No shared-ledger writes or payments. |
| Dashboard silently omits settlements without cached timestamps | Live settlement records do not consistently contain `blockTime`; the baseline candidate filtered that field before RPC verification | Read the actual finalized settlement timestamp; an earlier collection may count in the current settlement window | Regression passes for missing metadata and earlier collections. This is source/read-only verification, not a newly observed live payout. |
| FQA-003: prepared/partly paid window cannot reconcile late evidence | Baseline service rejected any prepared payout during review | Hash-bound additive reconciliation retains original ranks, scores, source manifests, retained balances and receipts; archives prior snapshot and operator reason. Only newly verified unassigned funding can be appended. Finalized payment-account/cycle inspection is read-only | Mocked paid and partly paid recovery/replay tests pass; altered original evidence and existing added-source cycles fail closed. All **348** exported live historical snapshots rebuild exactly, covering **23** recorded paid receipts. No live correction was executed. |
| FQA-004: used legacy rounding allocation | Baseline reconciler rejects changed creator-directed values for used plans | **Partial:** authenticated admin review/approval can record an auditable residual plan, bound to original plan hashes, exact finalized transfers, immutable beneficiary shares and current released counters/caps. Original plans and receipts remain untouched | One-lamport, uncertain transfer, forged/missing proof, negative residual, changed caps/shares, stale hash, concurrent preparation and persistence tests pass. Live two-source review had zero unreleased balance. **Residual transfer execution and downstream holder/X enrollment are not implemented by this candidate. The original guard remains.** |
| Agent 1 cadence/billing | Original candidate had one lifetime intent even for X promotion | Candidate scheduler uses a monotonic promotion sequence, 24-hour cooldown after verified delivery, and verified-billing gate | 14 mocked agency tests pass. **Actual agency funding and execution remain inactive.** |
| Real wallet-approved buy | User supplied signature `gdbpADHz…TE1Ded` for wallet `ER7zh…LFzXC` and mint `CkRQTe…814ky` | Independently read finalized transaction, wallet signature, Pump buy and token-account delta, exact app treasury credit | Finalized slot **512719619**. Token credit **625925486669719 base units**. Treasury `CmhmRt…mLy2` credited **2,500,000 lamports**. This is consistent with 50 bps on a 0.5 SOL quote; Pump instruction maximum input is 0.505 SOL. This was larger than the requested 0.001 SOL check. The chain receipt does not prove the text shown in the extension preview. |

Transaction: [Devnet explorer receipt](https://explorer.solana.com/tx/gdbpADHzddqx4mKfyR9mic1J8E193WTfnTiUT8CQW6R39SoCSdefLmZPgjQFchPuV2voRoCHUTp7pqYm8TE1Ded?cluster=devnet).

## Admin residual review

These endpoints require an allowlisted, wallet-authenticated administrator, the configured app origin, Devnet genesis and the pinned protected V3 program:

- `POST /api/admin/v3-allocations/review` with `mint`: read-only plan with exact target/released/unreleased beneficiary amounts and verified transfer references.
- `POST /api/admin/v3-allocations/approve` with `mint`, `expectedHash`, and an audit `reason`: records the approved plan and operator. Repeating the same approval preserves the original audit entry.

Approval records explicitly say `reviewed-residual-not-paid` and `executionStatus:not-executed`. Reward-vault funding is distinguished from actual holder/X recipient payments. Neither endpoint performs a transfer or bypasses the legacy payout guard.

## Checks

- Full unit run: **978 passed, 10 existing skips, 0 failures** (988 cases); subsequent API metadata/label edits passed the 23 affected tests.
- **19 production-bundle browser checks passed**, with mocked APIs, including historical/settlement eligibility labels, frozen-ranking explanation and pending-source status.
- Production build passed; existing large-chunk warning remains.
- Required critical gates passed unchanged.
- Source syntax: 1,042 JavaScript files; size budgets: 1,230 maintained files.
- All 348 historical snapshots reproduced byte-equivalent data and hashes from exported live state.
- Finalized chain checks were read-only. New mixed/late/negative/uncertain fixtures are mocked, not live financial execution.

Ignored evidence is under `data/qa-evidence/remaining-issues-20261019/` and `tmp/remaining-*`, `tmp/bonus-*`, `tmp/agency-cadence-tests.log`. Keys, generated artifacts and exports must not be committed.

## Still unfinished

1. A backward-compatible V3 agency contract extension with its dedicated 2% category, immutable team selections, per-agent caps and protected own-coin execution; browser/server decoders, launch/settlement support and verified Devnet deployment must follow. Current live policies retain their saved rates.
2. Actual agency X publishing/verified billing and own-coin $100k/$300k purchase/burn executors, durable submission recovery and finalized receipts. Candidate trigger decisions do not authorize execution.
3. Legacy residual transfer execution and holder/X source enrollment. The review-only implementation does not resolve a payable residual by itself.
4. A live, authorized additive bonus correction and residual recovery if a real affected source is identified. The inspected 348 snapshots had no `reconciliation-required` records; the reviewed two-source mint had no remaining beneficiary balance.
5. Exact-candidate publication and deployed acceptance. The separate navigation rollout observed during this work used `4dafc67`; it does not include this candidate merely because it uses the same checkout.

Do not report all remaining issues fixed, all agency agents active, or these new recovery paths paid from this progress report.
