# Raypad-inspired product flows

Implemented in the funded.app workspace on 2026-10-30. Inspiration was reviewed on Raypad's public Feed, Discover, Launch, Burns, Creators, and coin pages. Funded's saved fee policies, required signing permissions, and ranked windows remain authoritative.

## Discovery and trading

- Compact artwork: 112 px desktop / 84 px mobile. The Home introduction is smaller.
- Market observations, coverage, migration state, and freshness precede paid package/boost badges. Missing data stays unavailable.
- Home and Explore share a saved SOL amount. **Review buy** carries that amount to the token page, obtains a fresh quote through the existing trade flow, and requires explicit wallet approval. It never submits from a card.
- Mobile Buy/Sell occupy the existing navigation row on token pages. They open the existing accessible trade sheet, leaving token links reachable.
- Trade review retains maximum spend, minimum output, app fee, and slippage. A bounded read-only RPC request estimates network fees for the prepared instruction set; unavailable fees and additional account deposits are explicit. Final costs appear in the wallet.

## Rewards & Burns

Open `/#payments/activity`. The center shows separate Accrued, Awaiting approval, Funded, Processing, and Verified states, with per-record mint, wallet where relevant, action, reason, timestamp, and proof link.

Personal rows use the connected wallet's V3 experience projection and check up to eight creator launch fee overviews. Additional launches remain accessible in Portfolio. Wallet changes clear prior personal records. Vault funding needs recorded balance-delta evidence; it is never counted as recipient delivery. Public protocol burns require recorded source-debit and burn-instruction verification. $FUNDED base units stay separate from SOL and launched-token airdrops. Locked balances are not supply burns.

Existing holder cutoff/payout targets, token snapshot/deadline views, X claims, referrals, and ranked bonus dashboards remain linked. No early top-three bonus distribution was introduced. Each verified trade can wake ready processing under the existing rules; creator approvals and funding requirements still apply.

## Launch and creator retention

- Creator income: existing 80% creator / 20% protocol route.
- Holder rewards: fills 40% creator / 40% eligible holders / 20% protocol, with X at zero.
- Custom: uses the existing editable controls and signed validation. All presets show the live fee summary and preserve the two-step wizard, thesis, page preview, advanced options, and cost review.
- Token facts disclose confirmed RPC authority checks and their timestamp, recorded fee routing, creator wallet provenance, reserve evidence links, and advisory exact normalized name/ticker/image-URI matches. The registry check does not inspect image content or off-platform coins and is not a safety score.
- Creator wallet activity notifications are opt-in, saved on this device, and do not require X sign-in. Existing verified X identities still govern X creator-page management and X claims.
- Creator-page announcements can publish immediately or be scheduled within 30 days. Scheduling enables only when the authenticated API advertises support, preventing an older API from silently publishing a scheduled request immediately. The existing verified session, same-origin, CSRF, and rate limits protect writes. Ten pending announcements per creator are allowed; owners can cancel future announcements. Public profile, following feed, and update-card projections exclude future text until due. Public upcoming entries expose only ID and scheduled time. Publication is a read-time projection; reload after the time to view it.
- Return reminders are device-local (maximum 50, within 90 days). They appear while the app is open and link back to the coin or creator. They never schedule a transaction, sign on the user's behalf, post externally, or request OS push permission. View/dismiss controls are available on token pages, Rewards, and Profile.

## Measurement and strategy

The existing optional anonymous measurement channel accepts `first_verified_trade` and `return_visit` alongside launch completion and other journey events. First trade means first observed verified trade on this device; return visit means a later UTC visit day on this device. These are browser-reported, consent-controlled observations, not unique-user or chain-wide retention measurements. No wallet identifiers or amounts are added to telemetry.

The operator product report includes collection-to-settlement timing, pending settlement age, and funded-to-verified X, holder and ranked bonus payment timing. Timestamp samples are excluded when missing or inconsistent. X and holder timing use the latest 100-event V3 projection; ranked bonus timing uses validated immutable payout records and matching source funding. Funding-to-payment includes eligibility waiting time.

Growth follows creator discovery → launch context → reviewed trade → verified rewards → return reminder. Paid boosts remain labeled promotional; no arbitrary reputation score or unbounded fee subsidy was enabled. A subsidy campaign still needs a concrete budget, eligibility, and abuse controls before activation.

## Verification boundary

Automated browser fixtures use mocked Devnet reads and ephemeral public identities. They do not prove new on-chain payments. The separate local source preview proxies the existing reviewed V3 Devnet API and can show recorded live receipts. It does not publish the new workspace to the public hosted app.

No new contract, delegated signer, mainnet transaction, or production deployment is part of this UI delivery. True distribution inside every swap remains a separate reviewed contract change.

Earlier-pass validation, before the follow-up implementation:

- Full Node suite: 1,306 passed, 20 skipped. After adding the fee-estimation and API-capability cases, the final affected-module run passed 20 tests.
- 62 distinct browser cases passed across desktop/mobile and overlapping targeted runs; one existing case was skipped. Fixtures covered creator scheduling/cancellation and older-API rejection, reminder persistence/dismissal, saved trade intent, mobile action/focus behavior, financial evidence filters, launch presets, Favorites identity/focus preservation, launch budget navigation, and measurement preferences.
- Final build passed; 1,230 JavaScript files passed syntax checks; source size budgets and whitespace checks passed. Vite excludes generated trace/evidence directories to prevent test artifacts from reloading active pages.
- A source preview connected to the existing V3 Devnet API displayed 51 recorded verified burn receipts and four accrued entries. A saved 0.25 SOL buy intent reached its token page without a signature request. These were read-only observations; no new on-chain transfer is claimed.
- Scheduling requires the matching updated API. The current running API is not upgraded by these source changes; the capability guard keeps unsupported scheduling disabled.

## Follow-up implementation

The remaining experience work adds a Following feed with buffered updates, versioned creator briefs and communication draft templates, noncash delivery facts, a Ready now approval queue, persistent wallet-scoped recovery, exact receipt permalinks, visible portfolio calculation basis, reserve custody details, duplicate-identity mint links, notification preferences, public launch draft planning, enforced trade caps, typed search, reviewed guest reports and admin status review, and explicit preference export/import plus optional account save/load.

[Experience rollout and policy design](experience-rollout-and-policy-design.md) records the scope, API deployment boundary, missing-data rules, and separate designs for new opt-in milestone policies, future automated orders and a budgeted creator growth pilot. Existing financial entitlements and ranked windows are preserved.

The source preview read the existing reviewed Devnet API and displayed 51 recorded verified burn receipts, four accrued entries and a published bonus cutoff. This was read-only historical evidence, not a new payout or burn. The API's observed build remained `bbc999712933ae8ad6256e4fc63eb50c7c68d617`; the new backend routes were not deployed to it.

Follow-up validation completed locally:

- Full Node suite: 1,335 passed, 20 skipped. After the final receipt, Portfolio focus and storage-quota fixes, the affected-module run passed 78 tests. These are separate overlapping runs, not additive unique-test totals.
- 80 distinct browser cases passed across the final and targeted runs. Coverage includes all six native mobile launch-cost geometry/motion variants, launch availability and policy rejection, connected/disconnected Portfolio, refresh focus, mobile trade controls, exact receipts, sharing privacy, creator briefs, wallet delivery facts, reserve custody, reviewed reports, preference transfer and buffered search/feed behavior. One existing availability-baseline comparison was skipped because its external baseline URL was not configured.
- The broad run caught and led to fixes for a disappearing Created tokens tab, focus obscured by fixed navigation, and asynchronous creator-directory responses replacing search selection notices or unchanged options. The failing cases passed after their fixes.
- Storage-quota regression checks prove an unresolved public signature remains in memory and is labeled as temporary until persistence recovers. Extra stored fields are discarded. No signing credentials are stored.
- Final release build passed. Syntax checks covered 1,257 JavaScript files, with final changed files checked again. Size budgets passed for 1,457 maintained files; whitespace checks passed. The existing warning about large browser chunks remains.

Browser financial responses and write flows above use mocked Devnet fixtures and public test identities. They are not evidence of new on-chain payments. New backend functionality remains local-only until the matching API is deployed. Milestone escrow, delegated/automatic trading and an incentive budget remain the separate designs in the rollout document, not enabled financial mechanisms.

## Actual API candidate acceptance

The follow-up [local API candidate](product-experience-candidate.md) runs the current API and built browser on loopback port 8789 over a read-only export copied into isolated files. The public API remains on its earlier build. Real HTTP acceptance checks and three browser cases now cover the new endpoints without mocked API responses, including report persistence across an API restart. Missing verified sessions continue to block creator writes.

An existing burn was independently rechecked on finalized Devnet RPC: slot 516699579, vault debit 21,681 lamports and 2,785 $FUNDED base units burned. This verifies historical chain evidence, not a newly submitted burn. No signing keys or financial workers were enabled.

Runtime coverage exposed an additional gap: registry-based exact receipts do not cover every `onchain-policy` burn. Those rows now retain direct Explorer links, and engine-health coverage explicitly limits its operation counts to registered V3 launch policies. Six new isolation tests, 64 final combined affected unit tests, three actual-candidate browser tests and one mocked Explorer-link regression passed. See the candidate document for commands and evidence boundaries.
