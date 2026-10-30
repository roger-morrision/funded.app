# Experience rollout and future policy design

Source implementation: 2026-10-30. This document separates the delivered application work from future custody and financial policy changes.

## Application delivery

| Area | Implemented behavior | Evidence boundary |
| --- | --- | --- |
| Portfolio | Visible pricing and cost-basis coverage next to observed PnL | Observed matches are not complete wallet profit |
| Recovery | Device-persistent launch/trade references, wallet-scoped recovery, explicit verification, labeled in-tab fallback when storage fails | Timeout stays uncertain; finalized failure closes pending recovery; no automatic resubmit |
| Rewards | Ready approvals, processing outcomes, published bonus cutoff, exact receipt inspection | Funding, eligibility, recipient payment and supply burn remain separate |
| Receipt links | Exact historical signature filter before recent-event limit; mint-scoped gross recipient amounts; source collections; burn units; optional separate buy receipt | Recorded evidence and fresh finalized RPC trade verification have different labels; fees and net amounts can be unavailable. Referral earnings retain their existing protected flow and Explorer links |
| Financial engine | Completed/pending/failed operations, pending age, last delivery, collection/settlement and X/holder/bonus timing | Retry attempts and vault reconciliation stay unavailable without complete evidence; no allocation is counted as a payment |
| Feed | Following and event filters, buffered incoming records, explicit apply, more records | Loaded launches/trades/receipts plus opted-in published creator updates; incomplete coverage is visible |
| Creators | Dated versioned briefs, hidden updates, reviewed reports, communication draft templates, wallet delivery facts and noncash badges | Account ownership does not verify creator statements; returning wallets are not unique people |
| Notifications | Type filters, exact SOL threshold, digest grouping, local quiet hours, ready approvals and published cutoffs | Device-local while app is open; unknown USD conversions are unavailable; thresholds affect notices, not entitlements |
| Launch | Public draft planner, return time, resume/delete, final terms and timing summary, identity comparisons with mint links, reserve custody details | Requires return, fresh quote and explicit wallet signing; no mint reservation or automatic launch; artwork is not saved in plans |
| Trading | Saved slippage cap and estimated transaction-fee cap checked at review and again before submission | Unknown fees or unreadable saved limits block capped signing. Rent and trade spending are separate; wallet review remains authoritative |
| Search | Tokens, recorded creator wallets, public wallet addresses, transaction signatures and creator-directory names/handles | Identity, entitlement and transaction verification are separate; unavailable directory coverage is explicit |
| Guest progress | Optional export/import with reviewed merge; optional verified-X account save/load | No automatic account merge; only public follows and return reminders; no signing credentials |
| Support | Reviewed guest reports, optional public context, private status token, operator and signed-in admin review | No token-holding requirement; tokens hashed in storage; no report or private account preference in public creator projections |
| Measurement | Following-view, planned-draft and published-brief events join existing consent-controlled counters | Device/browser-reported funnel observations, never chain-wide unique-user retention |

New routes are mounted within existing request dispatchers. Admin review uses the existing allowlisted wallet session and same-origin check. Creator brief/preferences use the verified session, origin, CSRF and rate-limit gates. Guest reporting has per-IP/global quotas and bounded retention. PostgreSQL persists reports using its existing generic entity table.

The public API build was observed as `bbc999712933ae8ad6256e4fc63eb50c7c68d617`, on Devnet. New source routes were not deployed to that process. An isolated [local candidate](product-experience-candidate.md) now runs the matching API and built browser over copied recorded data, with real HTTP/browser acceptance and a fresh independent check of a historical finalized burn. Unsupported capabilities stay disabled or unavailable. No hosted deployment, external post or new on-chain payout is claimed by this delivery.

## Preserve existing economics

Current signed launch policies, beneficiaries, reserve custody rules and ranked bonus windows remain unchanged. A verified trade wakes processing only for work that is already eligible, approved and funded. The daily ranking window must close before a final bonus snapshot is payable. Trigger frequency and payout eligibility are separate.

The application does not advertise a protected/MEV-safe route where one is not actually integrated. Slippage and fee ceilings constrain the prepared transaction; they do not guarantee execution or profit.

## New opt-in milestone policy design

This is a future versioned contract policy, not an enabled toggle or a change to existing creator income.

1. Only new launches may opt in. The launch must sign the policy version, beneficiaries, asset, total capped allocation, milestone hashes, release rule, expiry and cancellation/refund recipient. A review screen must show every amount and decision authority before signing.
2. Use a separate PDA per launch/policy with explicit escrow deposits. An allocation is not an escrow balance. Creator income under earlier signed policies cannot be redirected into it.
3. Choose objectively verifiable milestone evidence or an explicitly named approval authority. A free-text creator statement alone cannot authorize release. Every release requires the pinned policy, verified funding, milestone approval and replay-protected release receipt.
4. States: drafted → signed → funding pending → funded → milestone approved → release pending → finalized recipient payment; rejection/expiry/refund are distinct branches. Lost responses retain the signature and require reconciliation before retry.
5. Partial releases must preserve exact base-unit accounting and remaining obligations. Program fees, rent and payer identity are explicit. Completion requires recipient deltas and PDA state changes, not a worker log.
6. Acceptance: unauthorized approval fails; wrong-mint funding fails; replay cannot double-release; simultaneous approvals cannot exceed the cap; expired/refunded balances cannot also pay; mainnet is gated until contract review and independent Devnet state-delta verification.

Until that contract and review exist, the UI shows the current policy and creator-stated milestones only. It does not promise vesting, automatic escrow release or a new APY.

## Alerts before automated trading

The delivered feed and reminders provide observed-trade and creator alerts. Following a wallet never authorizes a trade.

A future automated-order design requires a separate explicit mandate: allowed mints/routes, maximum order and daily spend, price/slippage and network-fee ceilings, expiry, revocation, replay protection, signer custody design and exact audit history. Missing prices, unavailable routes, stale quotes, wallet changes, revocation, or breached limits must prevent submission. Wallet approval cannot be implied from a saved follow or reminder. Copy-trading and delegated signing remain disabled; no credentials are collected for them.

## Creator growth pilot design

Use the new Discover → Follow → Review trade → Verify receipt → Return journey. A launch-day brief, a weekly progress draft and a receipt recap form the creator routine. All posts remain creator-reviewed, and paid placement stays labeled.

Any incentive pilot needs a separately allocated budget, start/end, per-wallet/per-launch limits, eligibility, approval owner and stop condition before activation. Default allocated budget is zero. Do not promise fee refunds, buybacks, bonus ranks or guaranteed yield as acquisition rewards. Evaluate opt-in funnel counts and observed verified receipts separately; device/session counts cannot establish unique-person retention or abuse-free eligibility.

## Evidence that remains unavailable

- Full vault opening + all verified inflows − all verified outflows = closing reconciliation needs matching asset, mint, slot range and complete source coverage. A current balance and recent receipts alone cannot prove it.
- Early-buyer concentration needs a complete, appropriately timed holder/trade snapshot; a mint-authority response is insufficient.
- Exact receipt trade fallback depends on finalized RPC availability and genuine program events plus token deltas. A missing record or RPC outage is not evidence of transaction failure.
- New API endpoint behavior is covered locally and with mocked browser fixtures. Hosted behavior and any new contract release require separate runtime and chain verification after deployment.
