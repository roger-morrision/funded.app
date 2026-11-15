# Product guide: every page and workflow

Reviewed against workspace source on 15 November 2026 (paired launches, Devnet fast-test mode and payout rules). This is source guidance, not a deployment or live transaction acceptance report. Check runtime network, feature gates, saved coin policy and finalized receipts. Devnet test assets have no monetary value.

Docs, Questions/FAQ and Help share explanations in `src/features/help/product-guidance.js` and `page-guidance.js`; the full topic catalog is `docs-topics.js`. Help opens a page-relevant answer and links to its guide. Existing topic deep links remain supported.

## Fees, rewards and action map

| Page / flow | What to do | Maintained reference |
| --- | --- | --- |
| Create a coin | Choose a 6h, 12h, 24h or 48h developer lock (12h default); review identity, costs, reserve, package and saved split; sign; verify mint and receipt | [Launch protections](launch-protections.md), [service fees](app-service-fees.md) |
| Create a coin: Paired with | Optional in step 1 where open (Devnet). Same router, split and fees as a SOL launch; reserve and developer buy paid in the paired token; developer buy is a second approval | [Paired launches](../README.md#paired-launches), in-app `#docs/paired-launch` |
| Coin detail / trading | Check quote, slippage, fee cap, wallet and network; verify finalized trade; reconcile uncertain sends | In-app `#docs/coin-pages`, `#docs/trading` |
| Rewards: creator | SOL coins: open Rewards, select your coin and claim available creator fees manually. Paired coins: paid automatically in the paired token by the Devnet worker | [Automation](onchain-automation.md), [collection](creator-fee-collector.md) |
| Rewards: holders | Check funded pool, finalized eligibility, price coverage and minima; no recipient claim. Paired coins pay in the paired token | [Automatic rewards](automatic-rewards.md) |
| Rewards: X | Sign in as the named account, link and verify the recipient wallet, claim and check the receipt | [X claims](x-fee-claims-devnet.md) |
| Referrals / Questions | Frozen first-touch upline; claim available three-level rewards in Referrals with the earning wallet | [Fee policy](protocol-fee-split-config.md) |
| Daily bonuses | Completed UTC window, verified rankings and source funding; automatic recipient payment | [Bonus rules](daily-bonus-policy.md) |
| Airdrops | Hold $RICH until migration; receive launched tokens automatically in proportion to eligible holdings | [Community airdrops](community-airdrop-devnet.md) |
| Buy & burn / $RICH | Distinguish manual/package burns from fee-funded $RICH purchases and burns | [Buybacks](buyback-devnet-executor.md) |
| AI Marketing | Check saved agents, own-coin milestones, budget and executor status | [Agency rules](marketing-agency-policy.md) |
| Rewards History / Analytics | Inspect finalized gross/net receipts, fees, rent and source coverage | [Measurement](product-measurement.md) |
| Admin | Allowlisted wallet sign-in; separate service-price and authority-signed policy changes; audited withdrawals | [Admin](admin-devnet.md), [financial rules](configurable-financial-rules.md) |
| Welcome / Home / Docs / Help | Pick a workflow, search guides, open page help; use Profile for reviewed issue reports | Sections below |

The agency defaults are 80% creator-directed, 8% Operations & marketing, 1% referrals (0.6/0.25/0.15), 2% AI agency, 4% Daily bonus and 5% $RICH buyback, all of gross collected creator fees. Published configuration governs new launches; existing coins keep their saved rates. The old fallback has 3% referrals and no agency category. File defaults do not prove live policy or worker activation.

Paired launches use these same rates and the same launch and trading fees. The community reserve and any developer buy are paid in the paired token; the developer buy follows in a second wallet approval that escrows every purchased token. Creator fees arrive in the paired token: the Devnet worker pays holders and the creator wallet in it and swaps the buyback and AI-agency budgets to SOL; operations, referral, X and Daily bonus shares stay in their token vaults for now. See [Paired launches](../README.md#paired-launches).

App service-price defaults are 1% trading, 0.02 SOL launch, $150 Pro, $300 Premier and $300 external listing in quoted $RICH burns. Listing is included for verified launches. Review current quotes; network, rent, Pump/pool costs and purchases are separate.

Collection → settlement → funding → eligibility/claim → finalized payment are separate stages. For SOL coins, creator fees, X rewards and three-level referral rewards require manual claims. Coin-holder SOL, Daily bonuses and migration token airdrops pay automatically after their eligibility and funding checks. The developer token lock does not hold creator SOL income.

## Home and getting around

Route: `#overview`. In-app guide: `#docs/home`.

Home shows launches, observed activity, reward allocations and next steps. Explore finds coins; Portfolio shows your holdings and projects; Rewards separates automatic payments from claims. Use the left menu on desktop or open the menu drawer on a phone.

1. Check the network label before connecting or signing. Devnet uses test assets. A Mainnet read-only preview does not enable transactions.
2. Home allocations and countdowns describe recorded funding or processing windows. Open receipts to check completed payments; a service status alone cannot prove a payout.
3. Use Docs for searchable guides. Open Help for this page in the menu for a relevant answer; desktop pages also offer a floating Help button.

## Search and discovery

Route: `#explore`. In-app guide: `#docs/search`.

Global search accepts tokens, recorded creator wallets, public wallet addresses, transaction signatures and available creator names or handles. Explore adds time, stage and tier filters, sorting and grid/table views. Check the mint when names or tickers look alike.

1. Use the arrow keys and Enter to open a search result. Escape closes search.
2. Observed volume, market cap and chart coverage can be partial or stale. Read timestamps and coverage; an unavailable source is not zero activity.
3. Favorites saves starred tokens. Following tracks selected wallets and available creator updates; it never authorizes copy trading.

## Portfolio and recovery

Route: `#my-launches`. In-app guide: `#docs/portfolio`.

Connect the intended wallet in Portfolio to inspect holdings, created coins and recorded activity. Portfolio pricing and profit/loss use the displayed observations and cost-basis coverage; they may not represent complete wallet profit.

1. Open a coin to inspect its balance, market source and available actions. Public profiles and private authenticated records have different coverage.
2. Recovery keeps public launch and trade references scoped to the wallet. Check an existing signature before retrying an uncertain submission; a timeout is not a finalized failure.
3. If device storage is unavailable, recovery can be temporary in this tab. Preserve the public signature before closing it. No private keys are saved by this recovery feature.

## Top 100

Route: `#top100`. In-app guide: `#docs/top100-ranking`.

The Featured view ranks verified directory coins by active boost total, then verified paid listing, Premier and Pro promotion, then 24-hour net market-cap increase and observed volume. Boost a listed coin from its row when directory boosts are enabled.

1. A rank reflects paid placement and observed market data; it is not an endorsement or a return forecast.
2. Unavailable market data is shown as "-", not zero.

## Create a coin

Route: `#launch`. In-app guides: `#docs/launch`, `#docs/paired-launch`.

The form has two steps. Step 1: name, ticker, image, project details and the optional **Paired with** token (SOL by default). Step 2: package (Standard, Boost, Pro, Premier), the creator-directed 80% split between your wallet, coin holders and a named X account, the community airdrop reserve (3–50% of supply, paid automatically at migration to eligible $RICH holders), an optional developer buy (up to 20% of supply) and its lock period. The review shows the full budget and the coin's saved fee policy before you sign.

1. A SOL launch is one atomic creation transaction with the launch service fee, reserve purchase, any package burn and the developer escrow.
2. A paired launch creates the coin and buys the reserve in the paired token, then asks for a second approval for the developer buy, which escrows every token it buys. Cancelling the second approval leaves the coin without a developer buy.
3. The coin is listed after the server verifies the finalized creation, V3 policy, reserve, service payment and any burn or escrow.

## Launch protections and developer tokens

Route: `#launch`. In-app guide: `#docs/launch-protections`.

richpad.fun prevents reuse of a ticker for 12 hours on this app, ignoring capitalization. New launches lock the declared initial developer token purchase for a selected 6h, 12h, 24h or 48h period (Devnet builds also offer a 5-minute test period) on-chain (12h default). Developer token locks do not delay creator SOL earnings; normal funding and payout conditions still apply.

1. Choose Token lock period beside Developer buy before signing. The initial developer purchase is capped at 20% of supply. Its lock starts at creation and the saved deadline cannot be changed; a zero developer purchase needs no escrow.
2. After unlock, the automatic release service sends the locked allocation to the original creator wallet and pays the network fee. No creator signature is needed. Delivery requires network confirmation and a funded, healthy service. Check Portfolio or the coin page; manual release remains a fallback if delivery is delayed. Existing locks retain their saved deadlines; launches without escrow are not retroactively locked. Later purchases, other wallets and extra tokens sent to escrow are outside the original locked allocation.
3. Ticker protection does not reserve names across Solana. Bundle-wallet signals have bounded coverage and can flag shared funding or timing; they do not prove common ownership or prevent selling.
4. The lock program is upgradeable. These protections do not guarantee a safe investment or an independent security audit.

## Launch drafts and completion

Route: `#launch`. In-app guide: `#docs/launch-plans`.

A saved launch plan is a public draft and a return reminder. It does not reserve a mint or ticker, schedule a transaction, or authorize signing. Resume the plan, restore artwork, obtain fresh quotes and review the final launch before approving it.

1. Review identity, package, story, image, creator-directed split, community reserve, initial developer purchase, selected lock period and the full SOL/token budget. Paid promotion packages require the displayed project fields and banner.
2. A launch may require setup before the atomic creation transaction. Network or rent costs from successful setup can remain if creation later fails.
3. After confirmation, use the completion checklist to inspect the mint, saved policy, reserve status, payments and included agents. Open the mint-specific airdrop link to check eligibility and custody.

## Get listed and listing recovery

Route: `#list`. In-app guide: `#docs/listing`.

Listing is included for a verified richpad.fun launch. For an external coin, Get listed checks the exact mint and metadata, then offers the current quoted $RICH burn when eligible. Listing, launch promotion packages and directory SOL boosts have separate terms and receipts.

1. Paste the mint on the selected network and inspect its identity and included-listing status. A failed metadata read does not prove an included launch owes a new listing fee.
2. For a paid listing, review the quoted burn, expiry and wallet before signing. A matching finalized burn is required and cannot be reused for another listing.
3. If confirmation is uncertain, retain and verify the existing transaction before another payment. Listing does not change the saved creator-fee split.

## AI Marketing and coin buybacks

Route: `#marketing-agency`. In-app guide: `#docs/marketing-agency`.

Every new launch includes two agents that buy and burn the launched coin. Promotion packages also include X promotion. Included agents share the separate AI marketing allocation equally. The platform $RICH buyback uses its own allocation and buys a different asset.

1. Default own-coin milestones are $100,000 and $300,000 verified USD market cap, once per agent per mint. Inspect the saved thresholds and budgets; future admin changes do not rewrite existing coins.
2. X promotion uses the saved cadence, at least 24 hours by default, and is billed only after verified delivery. Account limits, content review and publisher availability can delay it. A launch announcement is separate from recurring agency promotion.
3. The page separates published policy, funded budgets, worker readiness and completed receipts. X publishing can be paused while buyback workers remain independently available.
4. A milestone, quote or queued action is not a completed burn or post. Liquidity, protected spending, fresh market evidence and finalized purchase/burn proof remain required.

## Callouts and token chat

Route: `#callouts`. In-app guide: `#docs/callouts`.

Choose a coin from Callouts or open its Chat tab. Sign in as required and post a message. Verified token holders can create a call; other messages remain chat. Calls are limited to ten per hour and one per coin every 30 minutes.

1. Filter All, Hot or Mine and inspect Latest, Top callers and Conviction. Conviction means the caller held the coin when making the call; it does not establish continued ownership.
2. Caller rankings use the displayed sampled market-cap observations, mean observed peak, sample size and hit counts. Multiples are not realized wallet returns or guaranteed performance.
3. Read the caller profile, observation timestamp and Devnet context. If chat is unavailable, keep your draft and retry after checking status.

## Creator profiles and updates

Route: `#profile`. In-app guide: `#docs/creator-updates`.

Creator profiles can show public project details, versioned briefs, updates and recorded wallet delivery facts. Signing in verifies control of an account; it does not independently verify its story, roadmap or promises.

1. Follow creators to see available published updates. Apply buffered feed updates when ready; missing index coverage can limit the feed.
2. Creators review communication drafts before publishing. Editing a draft does not post to X or move funds. Scheduling depends on the available API and still requires the displayed review.
3. Creator account controls can exclude a page and block new support launches. Existing finalized receipts and entitlements remain recorded.

## Notifications and reminders

Route: `#profile`. In-app guide: `#docs/notifications`.

Reminders save to your verified wallet account and sync when you sign in. Notices appear while the app is open.

1. Ready approvals and published cutoff notices link to the relevant action. A reminder does not reserve a launch, submit an order or claim a reward.
2. Quiet hours use device-local time; Daily bonus windows use UTC. A cutoff is not a guaranteed payout time.
3. Following a wallet or saving a trade intent never enables automated or delegated trading. Reopen the action and review current terms before signing.

## Account settings

Route: `#profile`. In-app guide: `#docs/settings`.

Favorites, followed wallets, followed creators and reminders save to your signed-in account. Browser-only backups and share counters are removed.

1. Sign in with the same account on another device to load your saved items.
2. Wallet and X identities remain separate. Followed wallets, creators and reminders require your verified wallet account.
3. Saved slippage and estimated transaction-fee caps are checked at trade review and before submission. Unreadable limits or unknown required fees can block signing; rent and trade spending are separate.

## Help center and issue reports

Route: `#profile`. In-app guide: `#docs/reporting`.

Help provides guides and answers; it is not live chat. In Profile, use Report a problem or suggest an improvement. No wallet or X sign-in is required. Choose a category, describe the issue, optionally include public page/transaction details, then review the exact report before sending.

1. Report links beside a failed step can carry its public operation context. Context is included only when you opt in. Never include credentials, seed phrases, private keys or private account data.
2. Choose Review report, then Send reviewed report. Changes require a new review. A received report is not a promise of a response time or financial recovery.
3. Keep the report reference and private access token for status checks. If storage is unavailable, save them privately when shown. Do not share the token in public.
4. When the report service is unavailable, copy the reviewed text locally. An uncertain send should be checked before submitting again.

## Rewards

Route: `#payments`. In-app guide: `#docs/reward-actions`.

Rewards separates claims from automatic payouts: Coin creator, Coin holder, X claims and History.

1. **Coin creator:** claim available creator fees with the launch creator wallet (SOL coins). Paired coins pay the creator wallet automatically in the paired token on Devnet.
2. **Coin holder:** no claim. Eligible wallets receive SOL (or the paired token) after each funded period: hourly by default, 5 minutes in Devnet QA or fast-test mode.
3. **X claims:** the named X account signs in, links its receiving wallet and claims.
4. **History:** finalized payouts with receipts; an allocation or countdown is not a payment.

## Referrals

Route: `#referrals`. In-app guide: `#docs/referrals`.

Share your invite link. A creator's upline is frozen at first touch. Levels pay 0.6% / 0.25% / 0.15% of that creator's gross collected creator fees (1% total). Open Referrals with the earning wallet, choose Claim reward and sign the claim message; the payout is SOL. Missing levels stay in the community reserve. The Daily referrer bonus is a separate, automatic program.

## Daily bonuses

Route: `#bonuses`. In-app guide: `#docs/daily-bonus`.

The 4% Daily bonus pool is split equally between creators, direct referrers and traders. Each category pays its top three 50% / 30% / 20% after the UTC day closes at 00:00 UTC. Winners receive SOL automatically after the snapshot and source funding are verified; there is no claim. Devnet QA and fast-test mode use labeled 5-minute windows (fast-test covers the last two hours). See [Daily bonus rules](daily-bonus-policy.md).

## Airdrops

Route: `#airdrops`. In-app guide: `#docs/airdrop-policy`.

Each launch reserves at least 3% of supply for eligible $RICH holders. Hold $RICH until the coin migrates; the platform delivers tokens automatically in proportion to eligible holdings, with no claim or signature. When a drop's 90-day window ends, the worker closes it and returns undelivered tokens to the app owner. See [Community airdrops](community-airdrop-devnet.md).

## $RICH and buyback & burn

Routes: `#paid` (Buy & burn is merged into it). In-app guides: `#docs/funded`, `#docs/buyback`.

$RICH pays optional promotion and listing burns and qualifies holders for launched-coin airdrops. The 5% buyback allocation accumulates in program vaults; at the aggregate trigger (5 SOL normally, lower in Devnet QA) the worker buys and burns $RICH under protected spend checks. For paired coins the buyback budget is first swapped to SOL. Package burns and fee-funded buybacks are separate receipts.

## Leaderboard

Route: `#leaderboard`. In-app guide: `#docs/leaderboard`.

Views rank creators, traders and burners. Daily bonus standings reset each UTC day and can change until the cutoff; paid history is final. On Mainnet, trader ranks use trades placed through richpad.fun, read from the app fee wallet.

## Creators directory

Route: `#creators` and `/creator/x/<id>`. In-app guide: `#docs/creator-updates`.

Search creators or show only followed ones. A creator page lists coins supporting that account, creator updates and confirmed payout receipts. Listing a creator implies no earnings or endorsement.

## Service status

Route: `#status`.

Check service status runs an on-demand check of saved records and the Solana network and shows each result. It does not prove that a specific payout or worker cycle completed.

## Capital flow calculator

Route: `#capital-flow`. In-app guide: `#docs/capital-flow`.

Capital flow illustrates the currently published creator-fee allocation. Its input represents gross collected creator fees, not trade volume. The creator-directed portion follows each coin’s saved wallet, holder and X split; only Operations & marketing is the app allocation.

1. Inspect the saved policy for an existing coin. A changed new-launch policy does not reprice its collections or old settlements.
2. Collection, settlement, vault funding and recipient payment are separate stages. Do not add those stages together as revenue.
3. Completed-window rankings are separate from the calculator. Open Daily bonuses for finalized payout history and all-time recipients.

## Analytics and financial activity

Route: `#analytics-detail`. In-app guide: `#docs/analytics`.

Analytics summarizes indexed platform evidence with its displayed coverage. Financial activity separates completed, pending and failed operations. A current vault balance, an allocation, gross rewards and net received SOL measure different things.

1. Inspect exact receipts, source collections, token units, fee/rent details and recipient balance changes. Missing net amounts or proof remain unavailable.
2. Market volume covers observed activity in the stated window; some registered tokens trade through other apps. It is not necessarily richpad.fun-originated volume.
3. Worker heartbeats describe current readiness. Historical receipts describe past execution. Neither alone proves that every balance or pending obligation has been reconciled.

## Privacy and public sharing

Route: `#privacy`. In-app guide: `#docs/privacy`.

Wallet addresses and finalized Solana transactions are public. Sharing a coin, profile or receipt can expose those public identifiers. Review the exact content and destination before sharing; a connected wallet does not authorize a public post.

1. Device preferences, private dashboards, issue access tokens and verified-X account settings have separate access boundaries. Do not paste them into public chat or reports.
2. Optional measurement uses its displayed consent controls. Local notice preferences and quiet hours do not remove public on-chain history.
3. Read Privacy, Terms and Disclosures for product limits. Changing account visibility does not erase finalized transactions or saved financial entitlements.

## Updating and checking guidance

Update shared page copy and this reference when a workflow changes. Keep dates and receipts in historical audit/release reports scoped to their original run. Use the [documentation index](README.md) for maintained references. Do not convert a historical test, fixture, roadmap or configuration into a statement of current deployment.

Run source checks, the affected fee/guidance tests, Docs/Help browser regressions and a build. Browser fixtures verify navigation and copy, not on-chain outcomes.
