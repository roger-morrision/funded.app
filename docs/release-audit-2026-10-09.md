# Release audit — October 9, 2026

## Scope and evidence

The modular application was committed to main (`9b234f9`, then `965a4bb`) and deployed to https://funded.vip. This follow-up fixes defects found during the release audit. The final image/revision and post-deployment checks are recorded in the local release evidence under `tmp`.

### Fixed

- Denied session-storage access no longer crashes application startup when the mobile wallet controller is constructed. Storage access happens inside guarded mobile operations.
- Token-page favorites now update when account/guest favorites finish loading, including after reload. Previously the initial empty list could leave the star showing the wrong state.
- Browser fixtures now select the wallet explicitly and represent the current guest/account favorites contract.
- Retired pilot controls are asserted absent, with no usage events sent even for old consent values.
- Added `scripts/verify-release-ui.mjs`: real public reads, no injected financial data, transaction writes blocked, screenshots and explicit results/inventory.

## Results before final deployment

| Check | Result | Evidence |
| --- | --- | --- |
| Complete browser regression suite | 92 passed | `tmp/release-browser-final.log` |
| Public site UI, 17 routes at 390px and 1440px | 220 passed; no page exceptions | `tmp/release-ui-current-v2/results.json` and screenshots |
| Earlier responsive sweep, 360/390/768/1024/1440px | All 85 overflow and 85 route-isolation checks passed | `tmp/funded-vip-oct09-ui/results.json` |
| Earlier legacy UI assertions | 42 failures, largely obsolete selectors/copy; not represented as passing | Same legacy report; replaced current-control audit is separate |
| Windows unit suite | 574 passed, 6 Linux-lock failures, 2 skipped | `tmp/release-oct09-tests.log` |
| Linux full unit suite in build | 579 passed, 1 environment failure, 2 skipped | `tmp/modular-oct09-image.log`; render-devnet test requires Git and .git absent from image |
| Linux maintenance lock tests | All 6 passed | `tmp/modular-oct09-image-retry.log` |
| Build and critical contracts | Passed for deployed modular build | Same successful build log |
| Public release contract | Passed for `965a4bb` | Build identity, assets, deep links, validation, concurrent reads |

Browser regression fixtures are local/mocked. Public UI checks cover pages, responsive fit, disclosures, enabled tabs/view controls, and visible sort/filter select options. The control inventory is not proof that every button, external destination, authenticated state, disabled state, or transaction flow was executed. Chromium desktop/mobile viewport checks do not establish real Safari/iOS/Android wallet compatibility.

## On-chain and rewards blockers

- Configured Devnet RPC provider returned HTTP 429 `max usage reached`.
- The app was temporarily pointed at the public Devnet RPC. Basic status reads recovered, but reward/airdrop reads and the bounded trade preflight still returned HTTP 429 `Connection rate limits exceeded`.
- `tmp/release-devnet-trade.jsonl` records a preflight failure before signing or submitting any transaction. No new trade, launch, migration, payout, burn, transfer, or claim is certified by this audit.
- Preflight independently verified Devnet genesis and authorized QA wallet balances. The creator had about 0.163 SOL; this does not fund a migration buyout.
- Airdrop reserve verification returned 503. Automatic reward status was unavailable. Reward/community workers were unhealthy under the exhausted provider; app status alone does not establish settlement readiness.
- Existing indexed launches/receipts remain historical evidence. They are not new E2E transaction proof.
- Manual X sign-in/account ownership, live creator/referral/X claims, holder delivery, migration snapshots and community airdrop claims remain unverified in this run. No new X post was published.

Restore the configured RPC quota or securely configure a working Devnet RPC before resuming those flows. Keep transaction retries bounded and reconcile any submitted signature before repeating an action.

## Deployment safeguards

- Explicit task-owned paths committed; other checkouts left intact.
- PostgreSQL logical dump and reward ledger copied before app replacement (`tmp/funded-before-modular-oct09.dump`, `tmp/ledger-before-modular-oct09.json`). Workers remained running, so this is not a coordinated stopped-ledger snapshot.
- App replacement preserves runtime mounts/network configuration, with rollback compose files retained locally. Background worker images were not replaced during the app-only rollout.
- No dependency/private key material is included in the audit. Existing test keys were used in memory for read-only preflight; no keys were printed or newly persisted.
