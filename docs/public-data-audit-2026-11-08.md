# Public UI data audit — 8 November 2026

Mainnet decision: **NO-GO**. This is a Devnet UI/data repair, not Mainnet acceptance.

## Repairs

| Area | Failure | Change |
| --- | --- | --- |
| Token burns | Atomic mint snapshot omitted `isInitialized`, so every burn total failed validation | Preserve the verified mint initialization flag; keep authority, original supply and token-program checks |
| Token referral metric | V3 summary always displayed an unknown amount | Sum finalized recipient receipts for the selected token and network; distinguish incomplete history from zero |
| Home burn valuation | Price lookup only searched the launch directory, excluding the protocol token | Reuse the verified $FUNDED pool quote and refresh it while Home is active |
| Home, Explore and Analytics | Independent metrics waited for all collection, summary and history reads | Publish each result as it arrives with bounded requests |
| Public data loading | Temporary upstream failure became an immediate empty/unavailable panel | One shared retry for eligible anonymous GETs; 20-second deadline; respect long Retry-After responses; no replay of writes or private reads |
| Reconnect | Most route polls waited until their next scheduled interval | Refresh visible active routes after reconnect without overlapping their existing request |
| Error explanations | A global formatter replaced read failures and verification reasons with a dash | Restrict this formatting to value cells; retain explanations and recovery guidance |

## Verification

- Automated regression suite: 152 passed. Includes both token programs, confirmed supply snapshots, exact referral totals, network isolation, partial history, bounded retries, timeouts, authenticated/write exclusions and reconnect behavior.
- Production frontend build passed. CSS budget passed. Full source and size checks are recorded in the local audit log.
- Public pages inspected: Home, Explore, Rewards overview, Payment history, Coin holder, Coin creator, X claims, Airdrops, Referrals, Daily bonuses, Leaderboard, Marketing agents, Analytics, $FUNDED, Buy & burn, Fee distribution, Calls, Creators, Favorites, My launches, Create, Get listed, Docs and Profile.
- At a 390-pixel mobile viewport, none of those routes produced page-level horizontal overflow. All six registered launch token pages displayed supply-derived burn metrics. No console errors or warnings appeared in the healthy local browser session backed by the running Devnet API.
- Observed token data: QW4Q0L6Z had three finalized referral payments totaling 469 lamports; DAQA's current supply difference was 35,464,798.380439 tokens, or 3.546479% of original supply. These are timestamped Devnet observations, not permanent expected values.
- Public payment history contained 10 verified receipts totaling 38,263 lamports. Browser fault injection (mocked failures, real recovery responses) returned an initial 503 for launches, analytics and history; each recovered in two requests. A sustained history failure retained all 10 receipts with an explicit stale notice. Reconnect cleared the stale state.
- Home's 690 recorded $FUNDED burns had four verified receipts and a nonempty spot valuation after using the protocol pool. USD estimates change with the quote and Devnet values are not real money.

## Remaining empty states and limits

- No trades in a selected time range is an actual empty state; no chart points are fabricated.
- The Home market coverage was 6 of 7 directory entries. The listed external token lacks the supported Pump trade history; it is not counted as verified zero volume.
- P&L remains unavailable where complete wallet cost basis cannot be established. Partial purchases retain their coverage label.
- Private wallet balances, claims, creator actions, referrals and administrative flows require the appropriate signed session. This audit inspected their disconnected states and source boundaries; it did not sign transactions or exercise all authenticated financial actions.
- Automated buyback execution remains paused pending independent price-signer verification. Displaying a funded budget does not establish execution readiness.

## Mainnet gates

The offline readiness preflight still returns `ready:false`, `status:no-go`. Production identities, dedicated isolated infrastructure, durable metadata verification, approved deployment hashes and upgrade authority are not configured for an accepted Mainnet release. Mainnet launch, payout, indexing and claim flows still require completion and verification, independent program/custody review, and a capped canary with rollback evidence. See [Mainnet launch readiness](mainnet-launch-readiness.md).
