# funded.vip UI structure and retention review

Reviewed 5 November 2026. Recommendation only; application code and deployed services were not changed.

## Decision

Organize the product around five destinations: **Home, Explore, Create, Portfolio, Rewards**. Give each destination one clear job. Move protocol education and platform accounting into secondary navigation, and put creator management inside the relevant project.

The current product has a recognizable dark navy and amber identity, useful transaction evidence, browsing without a wallet, and substantial functionality. Its main weakness is the amount of product knowledge required before a visitor can make a simple decision. More promotional sections will not solve that. A visitor should quickly understand what funded.vip does, choose a task, complete it, and have a specific reason to return.

Million-user acquisition and retention are ambitions, not outcomes established by this review. These recommendations are hypotheses to validate with real users and cohort measurement. Product usefulness, reliability, supply of worthwhile projects, distribution, and trust matter alongside interface quality.

## Evidence and limits

- Live public site: https://funded.vip, signed out, labeled Solana Devnet. Desktop viewport 1440 × 1000 and sampled mobile screens at 390 × 844.
- Read all primary navigation destinations, reward subroutes, Welcome, $FUNDED/burn pages, public token/wallet/creator pages, creator settings, legal/privacy entry points, and the admin sign-in screen. See the coverage table and [raw observations](ui-structure-review-2026-11-05.json).
- Visually inspected desktop Home and Rewards and mobile Launch steps, Welcome, $FUNDED, and token details. Other visited routes were inspected through rendered text and controls; this is not a claim of screenshot review at every breakpoint.
- Entered a disposable token name/ticker to inspect both launch steps. No wallet or X account was connected; no launch, claim, trade, burn, paid promotion, or external post was submitted.
- Inspected local page markup, composition modules, CSS entry points, launch review markup, admin markup, and measurement documentation. Local/deployed source parity was not established. In particular, the live mobile site showed a bottom navigation bar while local navigation documentation describes a drawer-only layout.
- Some market data remained loading or unavailable during observation. Those are observed states, not a diagnosis of their cause or proof of a permanent outage. Earlier repository QA reports are context, not new verification.
- Authenticated portfolio, creator management, admin operations, wallet approval screens, and confirmed transaction outcomes remain unverified in this review. Several are covered only by source inspection.

## Highest-priority findings

| Priority | Observed evidence | User impact | Recommendation |
| --- | --- | --- | --- |
| P1 | Home and Welcome promise “Launch coins that pay everyone.” The supporting copy says holders get tokens from every launch; later pages explain snapshots, eligibility, funding and claim windows. | The first promise is broader than the conditions users encounter later. | Lead with “Launch a coin. Share trading fees with your community.” Put eligibility beside reward benefits, not only in a later disclaimer. |
| P1 | “Your rewards” contains public buyback accruals and protocol burns when signed out. Its History tab contains platform-wide payments. | Users can mistake public accounting for their own money. | Separate **My rewards** from **Public payment history** and **Protocol activity**. Show the account/network scope beside every financial total. |
| P1 | Rewards says “Claim rewards and track your payments,” but several reward programs pay automatically. Airdrops also labels automatic holder SOL payments “Airdrop for launched coin holders.” | Users cannot tell which asset they receive or whether action is necessary. | Reserve “airdrop” for token distribution. Use **Automatic SOL payments** and **Token airdrops**, with asset, eligibility, timing, and action on every row. |
| P1 | Leaderboard showed “left until today's ranking closes (00:00 UTC)” alongside a countdown consistent with a near QA cutoff; Capital flow said “Top 3. Every 5 minutes.” | Conflicting clocks damage confidence and cause unnecessary checking. | Use one schedule model and shared display: standard daily window versus explicitly labeled Devnet test window. Never imply cutoff means immediate payment. |
| P1 | Referral dashboard says payouts are automatic; the public Disclosures dialog says V3 referral payouts require creator-signed settlement and payout. | Users receive incompatible instructions. | Reconcile copy against the actual saved route: automatic when active; creator approval where applicable. Update all affected help/legal product descriptions together after policy review. |
| P1 | Home has 18 sidebar links including X, a launch ticker, multiple discovery controls, a quick-buy amount, detailed token cards, and lower fee/reward sections. | The first visit resembles an experienced trader's workspace before the user understands the product. | Reduce primary navigation to five choices. Distinguish newcomer Home from returning-user Home and full Explore. |
| P1 | Launch step one combines identity and fee splitting. Step two includes promotion tiers, AI agents, allocations, funding, story, preview and signing prerequisites. | The apparent two-step flow conceals many decisions. | Use three visible stages: **Details → Rewards & funding → Review**. Put optional paid promotion in a collapsed section or after launch. |
| P1 | Token detail showed unresolved price/chart/trading-stage data while paid boost and package badges were prominent. | Promotion can look more certain than the underlying information needed to decide. | Prioritize identity, market freshness, availability and trade review. Demote promotion; explicitly distinguish a paid label from verification of safety. |
| P2 | Welcome repeats benefits, six reward programs, a fee diagram and growth explanations across a long page. | A strong brand introduction becomes a product manual. | Limit the main story to five sections, with detailed economics linked contextually. |
| P2 | Reward activity displayed “1,873 $FUNDED base units”; Buy & burn displayed “0.001873 $FUNDED” for a corresponding burn. | Different representations make amounts difficult to compare. | Display human-readable token amounts everywhere; exact base units belong in expandable technical receipt details. |
| P2 | Pages combine UTC timestamps, locale dates, relative time, lengthy decimal amounts, upper-case labels, and multiple status wordings. | Users must repeatedly relearn scanning patterns. | Centralize formatting, terminology, status components and accessibility behavior. |
| P2 | The observed creator directory listed a profile whose detail route returned “unavailable or excluded.” | Discovery leads to a dead end, without explaining whether availability changed. | Filter non-discoverable profiles, distinguish temporary unavailability from exclusion where appropriate, and offer an immediate back/retry path. |

These priorities concern comprehension and task completion. They are not claims that financial verification should be weakened or hidden.

## Proposed information architecture

```text
Home
  New visitor: what this is, choose a task, how it works
  Returning visitor: resume, saved updates, rewards needing attention
Explore
  Coins | Watchlist | Following | Community | Rankings
Create
  Details → Rewards & funding → Review
  Secondary: list an existing coin
Portfolio
  Holdings | Activity | My projects
  Project: overview, updates, rewards, promotion, settings
Rewards
  Overview | SOL payments | Token airdrops | History
  Secondary: Referrals | Daily bonuses

More
  $FUNDED | Protocol activity | Fee distribution | Platform analytics
Help
  Getting started | Guides | Service status | Contact/report
Account
  Wallets | X account | Notifications | Privacy | Preferences
Footer
  About | Terms | Privacy | Disclosures | Creator exclusion | X
```

Use the same names and ordering across sidebar, mobile navigation, headings, page titles and help. Keep existing URLs and aliases working while labels change. Preserve saved tabs, filters, return focus and browser Back behavior.

Do not merge distinct concepts just to reduce navigation: Watchlist saves coins; Following subscribes to wallets/creators. Bring them together under Explore but explain the difference in their empty states. Referrals and bonuses remain reachable through Rewards and contextual links.

## Page-by-page recommendations and coverage

| Surface reviewed | Recommended structure and wording |
| --- | --- |
| Global navigation/search | Five primary destinations; a secondary More group; Help and Account anchored consistently. Keep network visible. Search placeholder: “Search coins, creators, wallets or transactions” only where all four are supported. Show grouped result types. |
| Home | Newcomer: concise proposition → Explore/Create choices → three-step explanation → small real activity sample → concise FAQ. Returning: resume draft, watchlist changes, relevant updates, reward actions. Remove full duplicate Explore grid and protocol accounting from default Home. |
| Welcome/About | Hero → how it works → choose a role → product preview/real evidence → FAQ and CTA. Replace “Most people do all four” unless measured. Remove unsupported comparisons such as “Most launchpads keep the fees,” or substantiate a narrowly scoped comparison. |
| Explore | Search and Trending/New/Watchlist/Following first. One sort and one filter control. Cards: identity, stage, market cap, 24h activity, freshness, save, View coin. Put fee split and promotion evidence in details. Offer quick buy as an experienced-user preference. Keep grid/table and current partial-data annotations. |
| Favorites / Following | Rename Favorites to Watchlist consistently if adopted. Empty Watchlist: “Save a coin to follow its price and updates.” Following: “Follow a wallet or creator to see their activity here.” Do not present empty personal results alongside unrelated platform payout rankings. |
| Token details / trading | Desktop: identity and essential stats above chart, trade panel alongside; mobile: compact identity/stats then chart and a single Buy/Sell dock. Tabs: Overview, Activity, Community, Rewards. Show fee basis, risk/availability and total costs at review. Keep receipts one click away. Preserve copied addresses and paid-label disclosure. |
| Launch, both steps and review source | Three visible stages. Keep basic identity fields together. Explain the creator-controlled share with a live example and optional sharing presets, keeping exact percentages visible. Show total estimated SOL and optional $FUNDED burn separately. Review must include network, immutable terms, destinations and costs before signing. Never label a paid launch “free.” |
| Launch promotion packages | Standard/Pro/Premier should compare deliverables, placement/duration, price and current availability. Every tier needs a usable professional coin page. A larger page is a weak upgrade reason. When X delivery is paused, state exactly which promised benefit is unavailable; consider disabling purchase of unavailable deliverables or presenting explicit deferred terms. |
| Portfolio | Holdings, Activity, My projects. Move saved coins to Explore/Watchlist, with a shortcut if useful. Signed-out state: one explanation and one connect action. Show transaction recovery only when relevant; keep unresolved transaction checks before retry. |
| Public wallet detail | Identity, follow, observed activity, created coins. Omit a balance card for another wallet if the product intentionally cannot display it. Mark scope and partial coverage once beside the relevant dataset. Use Retry and Explorer links for unavailable activity. |
| Rewards overview | Personal overview first: Needs action, Processing automatically, Received. Keep SOL and different tokens separate; do not sum token units into one balance. A compact “How rewards work” disclosure can explain the six programs. Public activity gets a clearly separate destination. |
| Holder SOL rewards | Start with wallet eligibility and latest payment when connected. Put other reward-paying coins below or in Explore. Tie every cutoff to the selected coin; do not make an arbitrary coin's schedule appear universal. Label “Automatic payment—no claim needed.” |
| $FUNDED-holder rewards / Airdrops | Single token-claim directory, with “Check eligibility” as the first action. Row: token, snapshot, eligible amount, funding, deadline, claim state. Default to actionable rows for a connected user. Separate planned allocation from funded/claimable amounts. |
| Creator rewards | Integrate into each project dashboard; keep a consolidated entry from Rewards. Distinguish saved recipient from fee-route owner. Show automatic delivery versus creator approval according to the actual route. |
| X rewards / creator settings | Explain the sequence: sign in with X → link wallet → check eligibility → review claim. Treat X identity and wallet ownership as different facts. Unavailable sign-in/publishing must have a precise state, preserved work and a return path. |
| Payment history | Default personal history when authenticated, with a visible scope switch for public records. Columns: source/program, asset, amount received, status, time, receipt. Show gross reward and net wallet change together when costs matter. Keep filters and receipt details; unify Daily bonus access. |
| Referrals | Invite link → qualified creators → earned/processing/received → history. Keep the useful numerical fee example. Put three-level mechanics and campaign tools behind details. Preserve “Earn from collected creator fees, not signups.” |
| Daily bonuses | Separate Current window, My status, Past winners. Display funded pool, eligibility basis, cutoff/timezone and payment state. Public winners are secondary to understanding eligibility. Make the current Devnet QA cadence explicit. |
| Leaderboard | Place under Explore/Rankings. Use named ranking criteria and a period selector, not a generic table that changes economic meaning across tabs. Keep observed-history limits. Separate paid promotion/burn rankings from trading/community contribution. |
| Callouts | Rename entry to Community, with “Coin calls” as a feature label. Prefer a single feed plus a Top callers tab over repeating the same posts across columns. “Holders at posting” is clearer than Conviction. Keep sample size and observed-peak methodology next to rankings; never relabel peak gains as realized returns. |
| Creator directory/detail | Link visibly from Explore/Community. Distinguish claimed/verified account ownership from merely being named in a launch policy. Make unavailable/excluded profiles recoverable and prevent stale listing links where possible. |
| AI Marketing | Rename “Promotion & automation,” reachable from My projects. Show project-specific availability, funded budget, next eligible action and latest receipt. Separate X posting from milestone buybacks. Replace agent numbering with action names. Retain the observed paused-X state. |
| Get listed | Accessible from Create and creator tools. Address → eligibility/existing entitlement → exact quote → review → confirmation. Explain paid listing versus launch package versus boost in a compact comparison. Label the burn as the payment mechanism and permanent before approval. |
| $FUNDED | Explain utility and eligibility first; market facts second; public supply/burn records third. Separate Buy $FUNDED from Burn $FUNDED. A protocol-token page should not make buying or destroying tokens the first learning step. |
| Buybacks / manual burns | Split fee-funded protocol buybacks from the user's optional manual burn. Use Recorded allocation, Verified available funds, Trigger, Executed, Receipt. Keep current readiness separate from historical success. Preserve the irreversible-burn review. |
| Capital flow | Rename “Fee distribution.” One diagram, one worked example, one calculator, saved-versus-current policy explanation. Move bonus tables to Daily bonuses. Present percentages of collected creator fees, never ambiguously of trade value. |
| Analytics | Four to six useful metrics with range, network, coverage and update time. Remove duplicated rounded/exact KPI blocks; exact amounts in details. Keep planned airdrop value separate from delivered rewards and volume separate from fee revenue. Devnet dollar references must not look like production revenue. |
| Wallet & settings | Group Account, Notifications, Privacy, Trading preferences, Device/sync and Support. Explain storage/sync scope within the relevant group. Avoid a dense explanatory paragraph above the page title. |
| Notifications | Provide a concise action inbox: claim deadline, confirmed payment, project update, transaction needing review. Group duplicates, expose notification preferences, make all alerts deep-link to the relevant state. Existing preferences should be reused. Delivery behavior was not exercised. |
| Docs/help | Keep search and existing 29-topic inventory; add task-oriented starting points: Explore, Launch, Understand rewards, Resolve a transaction. Put advanced accounting under How it works. Make guidance contextual and avoid making first-time users read the entire system architecture. |
| Privacy | Lead with data collected, local storage, optional measurement, identity links, public-chain records, and controls. Move general signing advice into Wallet safety. Share-visit measurement and app-usage consent need distinct, understandable labels. |
| Terms / Disclosures | Keep readable versioned documents and anchors. Put a short plain-language summary before full terms. Reconcile product behavior descriptions with current automatic/manual route policy, without removing material caveats. This is a UX recommendation, not a legal sufficiency assessment. |
| Opt out | Rename to “Creator listing controls” or “Exclude my creator profile”; the observed action is X creator exclusion, not general analytics opt-out. Keep privacy/measurement controls clearly separate. |
| Admin | Sign-in inspected live; operational sections inspected in source only. Group Overview/health, Funds, Fee policy, Automations, Support, Audit log. Keep authorization, irreversible-action reviews and operator evidence intact. Do not include Admin in consumer discovery. |

## Replacement copy

| Current wording | Suggested wording | Condition |
| --- | --- | --- |
| Launch coins that pay everyone. | Launch a coin. Share trading fees with your community. | Describe capability, not guaranteed income. |
| Long Home introduction listing all programs | Discover Solana coins, create your own, and track community rewards in one place. | Add “Devnet preview · test tokens have no monetary value” visibly in the current preview. |
| Launch coin / Launch a coin / Create a coin / Launch token | Create a coin | Use one action label; retain “Launch” for the final publishing action if helpful. |
| Claim rewards and track your payments. | See your rewards, check what needs action, and track payments. | Automatic payouts remain distinct from claims. |
| Airdrop for launched coin holders | Automatic SOL rewards for coin holders | Reserve token airdrop labels for token distributions. |
| Split your 80% | Choose how to share your creator-fee allocation | Help: “Allocate 80% of collected creator fees between your wallet, holders and an X account.” Use current policy values. |
| You keep 80% | You control how 80% of collected creator fees is shared. | “You keep” applies only if that share actually goes to the creator wallet. |
| Capital flow | Fee distribution | Subtitle: “See how collected creator fees are allocated.” |
| Creator-directed | Creator-controlled allocation | Include actual recipient split beside it. |
| Accrued | Allocated · awaiting funding or processing | Use the real state; do not infer funding status from accrual alone. |
| Verified | Payment confirmed / Identity verified / Policy verified | State exactly which fact was verified. |
| Curve cap | Market cap · bonding curve estimate | Keep estimation method and observed timestamp available. |
| Migrated | Trading on liquidity pool | Keep “Migrated” in details where protocol accuracy needs it. |
| Connect to review signing | Connect to view your wallet | Explain signing at the action that requests it. |
| Opt out | Creator listing controls | Do not confuse this with analytics consent. |
| Some figures are still being verified | Market data is updating. Last checked [time]. | Use only if updating is true; otherwise explain unavailability and offer Retry. |
| $— | Unavailable | Show last valid amount with timestamp only if available. |
| Agent 2 · $100,000 buyback | Coin buyback at $100,000 market cap | Render the saved trigger, not a hardcoded universal threshold. |

Keep “coin” for consumer-facing product language, “token address” for the field users paste, and exact technical terms inside explanations/receipts. Use $FUNDED capitalization consistently. Write button labels as verbs: View coin, Save coin, Check eligibility, Review trade, Review launch, View receipt.

## Layout and design system

Preserve the navy background, amber action color, wolf brand mark and existing locally hosted fonts. Improve hierarchy before changing the brand.

- One page title, one short description, one primary task, then the relevant content. Avoid a topbar title, eyebrow, repeated page title and another banner saying the same thing.
- Use a consistent spacing scale of 4/8/12/16/24/32/48 px, consistent panel borders and a small radius set. Suggested body text is 15–16 px, labels 13–14 px, metadata no smaller than 12 px; verify real density at each breakpoint.
- Use amber for primary actions/selection; neutral surfaces for ordinary controls; semantic colors plus text for status. Prices and paid tiers should not all compete with the primary CTA.
- Use compact rows for history and rewards, and cards for discovery. Do not wrap every explanatory sentence in another card. Keep metric names and number formats identical wherever reused.
- Show a compact asset amount; reveal exact precision in details. Preserve the minus sign for net outflows and never round a small nonzero amount to a misleading zero.
- Show local time for ordinary activity, UTC alongside protocol cutoffs, and exact timestamp/timezone in receipt details. Avoid ambiguous numeric dates.
- On mobile, preserve a consistent primary navigation model after verifying the intended deployed version. On token pages, consolidate the Buy/Sell dock and navigation so they do not consume excessive vertical space. On forms, prioritize Back/Continue and preserve keyboard-safe scrolling.
- Skeleton → data, partial data or actionable unavailable state. Do not leave indefinite “Loading…” placeholders without a retry/recovery explanation. Avoid blaming the user for a verification service problem.
- Preserve visible focus, semantic headings, keyboard tabs/dialogs, reduced motion and non-color status labels. Check at 320/390/768/1440 px and with text zoom. WCAG 2.2 AA specifies 4.5:1 normal-text contrast and a 24 CSS px target-size criterion with exceptions; use 44 px as a product target for primary mobile controls. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

Secondary technical information should be available when needed rather than repeated by default. This follows the principle of [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/). Material costs, irreversible terms, eligibility and action-blocking reasons must remain visible before commitment.

## Retention and growth plan

Start with two clear audiences: creators building a community and people following those communities. Keep referrers and protocol-token holders supported without asking every visitor to learn all roles at once.

| Loop | First useful outcome | Reason to return | Product support |
| --- | --- | --- | --- |
| Discovery | Find and save a relevant coin | New project updates or a meaningful saved-coin change | Watchlist, following feed, useful empty states, opt-in alerts |
| Creator | Prepare a launch and publish a usable project page | New holders, community questions, earned fees, next project task | Draft resume, post-launch checklist, project dashboard, updates and receipts |
| Rewards | Understand eligibility and complete any necessary action | Confirmed payment or approaching real claim deadline | Personal overview, asset-specific status, receipt links, opt-in reminders |
| Community | Follow a credible creator or contribute a useful observation | Replies and useful updates | Contextual profiles, sample-aware rankings, moderation and spam controls |
| Referral | Invite a creator who uses the product | Qualified activity and actual payment | Clear attribution, status and payment history; avoid implying signups earn money |

Do not use streaks, noisy countdowns, or trade-volume pressure as the primary retention mechanism. Measure repeat usefulness and user trust. Sharing should link to a meaningful public coin/creator page with readable previews and current availability; do not fabricate social proof or treat paid placement as popularity.

The live Devnet pages visibly contain QA coin names and test activity. Keep the preview unmistakable. For onboarding research, use an explicitly labeled guided example and a separate test-coin view; do not disguise QA traffic as organic adoption. Production social proof must come from actual production activity.

### Measurement

The current [measurement documentation](product-measurement.md) says uploaded event identity rotates daily and reports session-days, not unique people or cross-day retention. A `return_visit` event name does not solve this. Do not claim D7/D30 retention from those aggregates.

First establish consent-appropriate cohort measurement, with a documented identity model and explicit limitations. Do not silently expand tracking or use wallet addresses as a hidden cross-session tracking shortcut. Distinguish consenting users/accounts, devices, sessions, wallets and verified transactions.

- Primary outcome: **weekly returning activated users**, where an activated user has completed a defined useful task and returns in a later week for another useful task.
- Discovery activation: coin detail viewed and coin saved/followed. Creator activation: completed draft/review, then separately a verified published launch. Transaction submission is not confirmation.
- D1/D7/D30: returning members of a fixed first-activation cohort divided by the eligible cohort size. Define exact-day versus rolling-window retention before publishing it. Segment by role, device and acquisition source.
- Track landing-to-task choice, time to first useful outcome, launch step abandonment, quote-to-review completion, confirmed action success, recovery success, and reward-state comprehension.
- Guardrails: failed/repeated transaction attempts, unexpected costs, notification opt-outs, support reports, time to usable market data, accessibility failures and sample completeness.
- Acquisition: qualified activated users by source, repeat creators and successful referral activation; clicks and connected wallets alone are insufficient.

Run small moderated studies first: ask newcomers what the product does, what asset a reward pays, whether they must claim, and what a launch will cost. Test discovery, launch, reward checking and return visits separately. Then test major variants against a measured baseline. Suggested research acceptance gates—not industry benchmarks—are 8/10 newcomers correctly identifying the product and next action, 8/10 distinguishing automatic payments from claims, and 9/10 correctly identifying network and total reviewed cost. Validate with larger cohorts before claiming business impact.

## Delivery order

1. **Trust and comprehension:** fix overly broad promises, reward scope/asset/action labels, automatic/manual referral wording, cutoff labels, test-network context, unavailable states and package availability. Completion gate: the same economic fact agrees across landing page, app, review and help.
2. **Navigation and page ownership:** five destinations; separate Home/Explore; personal Rewards versus public protocol accounting; contextual creator tools; preserve deep links and preferences. Completion gate: newcomers can find the four main tasks without a guided tour.
3. **Core journeys:** three-stage creation, compact coin/trade view, reward state rows, clear costs and recovery. Completion gate: desktop/mobile and keyboard journeys preserve all financial review and confirmation requirements.
4. **Visual consistency:** consolidate components, typography, spacing, statuses and formatting. Completion gate: no clipping/obscured controls at target widths, correct focus and contrast, stable loading/empty/error layouts.
5. **Return experience:** useful Home, project updates, watchlist, opted-in reminders and reliable deep links. Reuse existing preference/feed infrastructure. Completion gate: event definitions and consent-aware cohorts work before retention claims.
6. **Acquisition experiments:** creator onboarding, understandable shared pages and referral distribution. Scale the channels that bring retained activated users, after earlier gates pass.

No calendar estimate is implied; size each phase after agreeing the scope and checking the deployed baseline.

## Implementation notes

The local `index.html` references 47 stylesheet links. There are multiple presentation layers such as `professional-ui.css`, `interface-polish.css`, `product-experience.css`, `page-cleanup.css`, and `styles/pages/clean-pages.css`. This count is evidence of multiple styling layers, not a measured performance result.

Text and layout are also changed after initial markup by `product-experience.js`, `workspace-ui.js` and feature modules. Centralize route metadata, display vocabulary and shared presentation gradually; adding another global override layer will make future consistency harder. Keep transaction logic, policy models and proof checks authoritative.

Likely implementation entry points:

- `index.html`, `src/features/workspace/navigation.js`, `workspace-ui.js`: shell, labels and navigation.
- `src/features/workspace/rewards.js`, `src/features/experience/financial-center.js`, `src/features/experience/reward-guidance.js`: personal/public reward structure.
- `src/features/fees/fee-policy-copy.js`: shared current/saved policy explanations.
- `src/features/callouts/page-markup.js`: community page structure and terminology.
- `launch-review-markup.js`, launch feature modules: staged creation and review.
- `styles/pages/clean-pages.css`, shared component CSS: consolidation of page patterns.
- `product-events.js`, `product-measurement.js`, `docs/product-measurement.md`: event semantics and measurement limits.

Implementation should reuse existing useful features—draft recovery, watchlists, following, payment evidence, partial-data annotations, network gates, account preferences and report context. Verify both the source and the actual deployed build; the observed layout/documentation difference makes that distinction important.
