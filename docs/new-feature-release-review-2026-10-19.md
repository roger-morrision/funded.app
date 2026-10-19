# New feature release review — 19 October 2026

## Inventory and integration

Baseline: `aba752796d5a5b22952b18c00ee758151859c32d`, independently compared with the working tree, Git objects, and the untracked QA handoff reports. Those reports are inputs, not proof of inclusion or runtime success. No additional application code was uncommitted at intake. The `docs/qa-dev-loop/` input reports remain separate from this release's source changes.

| Item | Source commit | Classification and evidence |
| --- | --- | --- |
| Current readiness separate from historical payout receipts; coverage and launch-link UX | `d5701ab`, `e6c7563` | Already included in baseline. New browser regressions cover receipt coverage, required/optional launch order, keyboard behavior and desktop/mobile geometry. |
| Configurable service fees, signed admin editor, atomic launch fee, paid promotions/listing, agency preview | `fe9b144` | Already included. Current defaults are 0.5% app buys/sells, 0.02 SOL per launch, $150 Pro / $300 Premier burns, $300 external listing burn, and included listing for funded.vip launches. Agency execution remains disabled. |
| PostgreSQL launch fee quote persistence and one paid QA launch recovery | `90f4846` | Already included. Quotes persist as their own bucket and are read back before payment preparation. Prior recovery kept the original transaction and creator signature, without a second charge. |
| Home picker retains current admin prices after view switching | `af22d6e` | Already included. Browser tests recheck both default and changed prices after Creator/Community switching. |
| User correction to 0.5% buys and sells | `aba7527` | Already included and preserved. Live admin revision 2 was separately saved; prior four finalized Devnet trade receipts are in the evidence directory below. |
| FQA-005: request-scoped finalized proof read deduplication | `8cc9442668ec3ae30bd1441b70e8c20eb9e615a3` | Needed integration: source file and tests were absent, and Git confirmed it was outside baseline ancestry. Cherry-picked as `405f88ad98f11980a4efc2c72f58af4ef12b123e`. Patch reviewed independently. Complete source history and all proof checks remain; only identical explicitly finalized RPC reads are shared within a single reconciliation pass. |
| FQA-007: Node fee-policy verifier imports browser CSS | `a44f11630cae2a4c6529ca69d29340c003399f5d` | Needed integration: reproduced `ERR_UNKNOWN_FILE_EXTENSION` with the unchanged verifier before integration. Cherry-picked as `400a612d6aff1f6463ff01eee5859aec8c2e6153`. Stylesheet moves to HTML; browser-only startup is guarded. Stylesheet content, fee amounts and verifier assertions are unchanged. |
| FQA-002: unsettled source blocks Daily bonus ranking | No implementation commit | Reported gap requiring an explicit late-settlement/cutoff rule. Do not pay a ranking that can change when creator/referrer evidence arrives later. This release does not change that rule. |
| FQA-003: recovery after a bonus day is prepared/partly paid | No implementation commit | Reported gap requiring a reviewed residual-obligation recovery design. Existing paid manifests/receipts must stay immutable. No such recovery is claimed here. |
| FQA-004: used legacy allocation needs rounding adjustment | No implementation commit | Reported gap requiring a reviewed residual accounting rule. No current affected live mint was established by the handoff. Existing rejection/preservation behavior remains. |

Both missing commits integrated without conflicts, one at a time. Their source SHAs and new SHAs are recorded above; ancestry is supplemented by patch inspection and behavior tests. No force push, generated evidence, private keys or secrets are included.

## Completed validation before publication

- FQA-005 integration: **17 affected unit tests passed**. Coverage includes many-source history, shared RPC calls, freshness between requests, failed/changed/non-finalized proofs, missing history, and preservation of previously used allocations.
- FQA-007 integration: unchanged `npm run verify:critical` passed, including backend hardening, production policies, fee policy and receipt evidence. The prior Node/CSS failure was independently reproduced before applying the patch.
- Full suite: **963 passed, 10 skipped, 0 failed** out of 973 tests. Skips remain explicit and are not counted as coverage.
- Production build passed. Existing large-chunk warnings remain.
- **44 browser tests passed using mocked APIs** across service fees/admin, launch packages/links, agency preview/styles, referrals, bonuses, wallet history, favorites/following and fee-policy pages. Browser pass is not a payment proof.
- Tests ran against committed application source. This report's commit only adds documentation to the already-tested integration.

## Post-deployment acceptance and evidence

The production image must be built from a fresh Git archive of the final release commit. Verify its revision label, all managed services, public `/api/status`, Devnet settings, current fee policy, V3 readiness, and the agency preview at desktop/mobile widths. Record actual results in `data/qa-evidence/new-feature-release-20261019/` (ignored operational evidence).

The intended live allocation check uses a cloned in-memory store and finalized RPC reads only. It cannot approve, fund, settle or pay a recipient. Any failed legacy allocation check must be reported explicitly; it is not permission to change historical payment amounts.

Previously finalized fee evidence lives in `data/qa-evidence/service-fees-1792389659451/` and `data/qa-evidence/trade-fee-50/`. The first directory includes historical 0.75% trade receipts. Only the second directory proves the corrected 0.5% rate. Re-reading these receipts does not constitute a new payment.

## Limits

- No new creator/holder/X/referral/bonus payout, migration claim, promotion post, or buyback execution is authorized or proved merely by rendering its page or receiving an HTTP 200 in this run.
- Wallet-extension approval remains a separate verification step; mocked browser providers and prior SDK-signed QA trades do not prove it.
- AI agency allocation/executors remain unactivated. The UI must show that state; its 2% budget and 1% referral proposal are not the active 80/20 protocol policy.
- FQA-002/003/004 remain reported policy/recovery gaps, not silently closed by this release.
