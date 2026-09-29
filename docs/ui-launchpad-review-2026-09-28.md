# funded.vip UI review and enhancement backlog

Review date: 28 September 2026. Recommendations only; no application code changed.

## Assessment

The app has a credible dark visual direction and unusually useful fee, allocation, and receipt information. Its main weakness is hierarchy: too many destinations, repeated introductions, competing controls, and detailed policy explanations before users reach their task. Improve that hierarchy before adding more features or decoration.

Recommended product direction: a focused launchpad with transparent rewards. Make Explore, Launch, Portfolio, and Rewards the primary destinations. Keep protocol evidence accessible through concise status summaries and expandable details.

## Evidence and scope

- Reviewed current HTML, presentation modules, and styles in this workspace.
- Opened the local Vite app and inspected Home, Explore, Launch, My Rewards, My projects, Analytics, Referrals, Community, Leaderboard, Airdrops, Burn $FUNDED, Capital flow, Docs, Profile, and one token detail page through browser DOM/accessibility output. Visually inspected desktop Home, Explore, and Launch screenshots.
- The local application showed Devnet records and a development wallet connection. No wallet connection was initiated, no messages were signed, and no transactions were submitted for this review. Displayed numbers are observations of UI output, not independently verified balances or settlement evidence.
- This is a design and information-architecture review, not a full functional, accessibility, or on-chain audit. Populated production, error, and disconnected states need dedicated acceptance testing.
- At an emulated 390px mobile viewport, Explore, Launch, and My Rewards each had a 390px document width: no horizontal page overflow was measured in those states. Explore timeframe controls measured 30px high and sort shortcuts 32px; Launch amount presets measured 32px. Increase these toward the proposed 44px touch target. These are DOM measurements, not a complete mobile visual or assistive-technology audit. A token-page screenshot request stalled, so additional screenshot capture was stopped.
- Competitor research uses public first-party pages and documentation. It is a representative comparison, not a claim to have examined every launchpad or authenticated workflow. Research freshness varies by source; recommendations do not depend on competitors' fee amounts.

## Competitive comparison

| Reference | Supported pattern | Application to funded.vip |
|---|---|---|
| [Pump.fun creation](https://pump.fun/create) | Token identity, optional social links, media, and preview grouped around creation | Lead with identity and preview; collapse optional storytelling fields |
| [Raydium LaunchLab guide](https://github.com/raydium-io/raydium-docs-v1/blob/main/user-flows/creating-a-launchlab-token.mdx) | Distinct simple and configurable launch paths, followed by review | Preserve funded's required economics, but put optional configuration behind an Advanced disclosure |
| [BONKfun](https://www.bonk.fun/) | Discovery exposes token identity, market cap, and progress | Use a stable, small metric set in every discovery card |
| [Bags claim guide](https://support.bags.fm/en/articles/13434893-claim-fees) | Profile-based, token-specific claim entry points after X authentication | Put each reward beside its token and show the relevant authentication requirement |
| [Meteora launch guide](https://launch.meteora.ag/) | Launch products and advanced configuration have explicit categories | Separate everyday creation from specialist configuration; do not add unsupported launch modes |
| [Four.meme](https://four.meme/) | Token search, categories, filters, and graduation discovery | Make lifecycle filtering easy without adding another large dashboard above results |
| [Flap](https://flap.sh/board) | Comparable market-cap, volume, tax, price, and change fields | Use consistent units and explain fee bases in context |
| [Clanker](https://clanker.world/) | Direct launch/explore actions and a short path into trending tokens | Shorten the homepage and get visitors to real token records quickly |
| [PinkSale creation guide](https://docs.pinksale.finance/launchpads/create-a-launchpad) | Sequential configuration and review before submission | Use clear steps, per-step validation, and an explicit final summary |

[Moon.it](https://moon.it/) returned a “Back soon” page in this research, so it is not treated as an active interface benchmark. Bags' main page did not yield inspectable content through web extraction; its comparison above is based on the official help guide. These references support interaction patterns, not a pixel-by-pixel visual ranking.

## Highest-impact findings

| Priority | Observed evidence | Recommended change | Acceptance condition |
|---|---|---|---|
| P0 | 13 sidebar destinations; Community is actually saved launches | Reduce primary navigation; rename Community to Watchlist; nest secondary tools | A new user can locate discovery, creation, owned projects, and rewards without interpreting internal categories |
| P0 | Home's large hero, six participant explanations, burn explainer, and 12 KPI cards precede or compete with discovery | Compact hero, two clear actions, at most four headline metrics, then token feed | Token records or a useful empty state appear in the initial desktop viewport |
| P0 | Explore has a trending strip, duplicated search, tabs, view toggle, timeframe, sorting shortcuts, and four comparison cards above token cards | One compact toolbar; advanced filters in a drawer; optional comparison panel below results | First token row appears above the fold at the agreed desktop reference size |
| P0 | My Rewards opens an X-only SOL claim page | Aggregate Creator, Holder, X partner, Referral, and Airdrop rewards with role-specific subviews | The page name accurately describes its contents; X login is requested only for X rewards |
| P0 | Launch uses Create coin / Launch a token / Launch your Pump coin / Launch a project | Adopt “Launch token” consistently and use one page introduction | One H1, one purpose statement, one primary next action per step |
| P0 | Paid Boost benefits mention a “Verified badge”; discovery separately uses “RPC VERIFIED” | Separate promotion from evidence: Promotion tier, Identity linked, On-chain record confirmed | A purchased tier never resembles a security review or endorsement |
| P1 | Token page repeats snapshot, fee metrics, payouts, and explanations before trade content in document order | Put token identity, essential market facts, chart/snapshot, and trade panel first; fees and proof in tabs | A user can inspect price context and prepare a trade without scrolling past accounting explanations |
| P1 | Launch has Standard/Boost/Pro/Premier; burn has Gold/Diamond | Either consolidate names or explicitly distinguish promotion tiers from burn milestones | No unexplained parallel tier systems |
| P1 | Analytics exposes “creator-support-v10” and “PostgreSQL”; several pages repeatedly describe indexers and proof internals | Use user-facing status copy; preserve raw evidence in Details | Main page explains availability, consequence, and recovery action without backend jargon |
| P1 | Cards expose precision such as $0.0000001179 and ages such as 218h; some zero-value tokens appear in Trending | Standardize formatting and define honest ranking/empty rules | Tiny values are readable; no-activity states do not imply popularity |
| P1 | Airdrops repeats allocations in My airdrops, All airdrops, and rankings, plus creator and recovery tools | Separate claim experience from program management | Claimants see their eligibility first; creator tools appear in a management view |
| P2 | Multiple presentation layers override one another | Consolidate design tokens and shared components incrementally | Route styles consume shared primitives instead of repeating visual overrides |

## Proposed navigation

Primary: Explore · Launch token · Portfolio · Rewards.

Explore contains All tokens, New, Graduating, and Watchlist. Only offer a ranking when supporting data exists. Portfolio contains My projects and project management. Rewards contains Overview, Creator, Holder, X partner, Referrals, and Airdrops; retain distinct authentication and settlement requirements.

Secondary: Analytics, $FUNDED, and More. Put Capital flow within Analytics; put buyback policy and burn receipts under $FUNDED. Put Docs, disclosures, status, and a useful leaderboard under More or the footer. Keep the public Home page as an introduction; returning users should be able to choose Explore as their landing page. Preserve existing deep links through redirects or route aliases.

## Shared visual system

1. Keep a charcoal/navy base with three surface levels. Use one primary violet accent; reserve green, amber, and red for meaningful states. Avoid assigning a different background palette to each feature.
2. Retain Manrope if desired. Use 16px body text, 14px labels/secondary text, and approximately 12px compact metadata as starting targets. Use 28–36px page titles and 40–48px marketing headlines. Validate actual computed contrast and readability; source CSS alone does not establish compliance.
3. Use monospace selectively for addresses and precise numbers. Apply tabular numerals to comparable metrics; keep explanatory paragraphs in the body font.
4. Adopt a spacing scale of 4/8/12/16/24/32/48px. Standardize card padding, field gaps, section spacing, and container widths. Use a narrow form container and a wider discovery/trading container.
5. Standardize cards at one base radius, controls at another, and pills only for short states. Reduce nested bordered boxes and decorative gradients.
6. Define Primary, Secondary, Tertiary, and Destructive buttons with shared heights and states. Prefer a 44px mobile target. Give each local workflow one dominant action.
7. Replace mixed Unicode navigation symbols with a single SVG icon family, consistent stroke and 18–20px size. Keep text labels; give icon-only actions accessible names.
8. Build shared PageHeader, TokenIdentity, TokenCard, Metric, StatusBadge, FilterBar, EmptyState, TransactionStatus, and ReceiptRow components. This can be done in the current stack; a framework migration is not required.
9. Document loading, empty, error, disconnected, unavailable, stale, partial, pending, and confirmed states for every data component. Do not style all of them as muted placeholder cards.
10. Define a vocabulary: Token, Launch token, Portfolio, Rewards, Market cap, Trading volume, Allocation, Available to claim, Paid, and Burn confirmed. Use sentence case consistently.

## Screen-by-screen enhancements

### Home

- Suggested headline: “Launch a token. Make rewards transparent.” Supporting sentence: “Create on Solana, configure fee sharing, and track confirmed payouts.”
- Put Launch token and Explore tokens beside each other, with one primary treatment.
- Show four relevant, verified headline metrics at most. Keep the full 12-metric dashboard in Analytics.
- Replace six large stakeholder cards with three concise paths: Launch a token, Explore tokens, Check rewards. Link to the full economics explanation.
- Put the launch feed immediately below the introductory block. Use explicit zero/empty states when activity is absent.
- Move the referral tutorial and burn-policy explanation further down or to their dedicated pages.

### Explore and token cards

- Toolbar order: search, lifecycle tab, sort, Filters, view switch. Integrate or suppress redundant global search while on Explore.
- Place active filter chips and Clear all directly below. Preserve query state in the URL where practical.
- Card hierarchy: image/name/ticker; market cap and period volume; lifecycle/progress; one reward summary; primary Open token action.
- Make reward summaries expandable: distinguish 3% of token supply from 20% of collected creator fees. Never combine different percentage bases into an unexplained badge row.
- Put promotion labels in a separate slot. Avoid “Standard Promo” on every normal token.
- Use a compact row/table layout for frequent comparisons and a card layout for browsing. Keep metric order and labels identical.
- Avoid resorting rows while the user is hovering, focusing, or scrolling. Offer an update control when fresh ranking data arrives.
- Use “Recent launches” if there is insufficient activity for a credible Trending view.
- Default unknown data to an em dash with a reason; use 0 only for an observed zero. Show tiny positive USD amounts as < $0.01 where appropriate, retaining exact values on demand.
- Format ages as minutes/hours/days appropriately and expose an exact timestamp. Provide copy feedback on token addresses.

### Launch

- Use three steps: Token details → Launch settings → Review and launch.
- Keep name, ticker, image, and preview first in both visual and keyboard order. Verify responsive CSS does not reorder the workflow confusingly.
- Collapse story, roadmap, and social fields under optional details. Preserve the existing simple/custom fee-route choice, but explain the outcome of each in one sentence.
- Use grouped number formatting, unit suffixes, and synchronized amount/percentage feedback for the community reserve.
- Show a compact fee distribution bar with labeled destinations and a total. State whether percentages are of supply, gross creator fees, or the creator-directed portion.
- Make paid promotion optional and collapsed by default. Describe the actual benefit and burn requirement without implying audit quality.
- Replace the ambiguous “FREE LAUNCH” headline with “Platform launch fee: 0” and show network/account costs separately.
- Keep a sticky summary on desktop and a collapsible summary above the mobile action bar. Show estimated spend, reserve, fee split, network, and immutable settings before signing.
- Show specific inline errors and link the error summary to the first invalid field; avoid relying solely on “FIX COIN DETAILS”. Preserve non-sensitive drafts and recover after wallet rejection.
- Explain signing stages: Preparing → Awaiting wallet → Submitted → Confirmed. Add a separate indexing status if the chain confirmation precedes the app record.
- Keep material economics and irreversible choices visible in the review; disclosures must not be buried solely in tooltips.

### Token detail and trading

- Desktop: token identity and four primary metrics, then chart/snapshot with a trade panel beside it. Secondary tabs: Activity, Rewards, Distribution, About.
- Mobile: compact identity and metrics, chart/snapshot, and an accessible Trade button opening a sheet. Keep amount, estimate, fees, and confirmation reachable above the keyboard.
- Correct the route header: the inspected token page still showed Overview and its generic subtitle.
- Clearly distinguish an on-chain snapshot from historical price data. Never draw a trend chart from one observation.
- Show buy/sell, amount, wallet balance, quick amounts, estimated receipt, minimum received, total fees, and quote expiry coherently. Keep slippage and specialist settings expandable.
- Use plain-language identity labels such as Creator wallet and Fee recipient. Put the exact addresses and source records in expandable facts.
- Keep community discussion below core token/trade information; distinguish message signing from transaction signing.
- Collapse long fee-collection explanations into How rewards work. Preserve claim thresholds and readiness reasons beside the relevant action.

### Portfolio and wallet

- Replace trader-style duplicated cards with creator-oriented rows: token, launch status, fees accrued, available reward, and Manage.
- Separate Draft, Pending confirmation, Live, and Graduated states. Keep historical receipts accessible from each project.
- Unify Profile and wallet details into a clear account area with wallet, network, linked X account, activity, and preferences.
- Put the network beside the wallet in the header. Make the development environment obvious without repeating large disclaimers on every panel.

### Rewards, referrals, and airdrops

- Rewards overview: Available to claim, Pending, Paid, then token/role rows. Do not sum unrelated token quantities; any cross-asset USD estimate needs pricing coverage and freshness.
- Show each row's next action: Connect wallet, Link X, Await snapshot, Claim, or View receipt. Explain disabled actions beside the button.
- Referrals: lead with link, qualified activity, claimable amount, and receipts. Collapse the three-level explanation and channel toolkit. Clarify whether links are active, unverified, or previews.
- Airdrops: default to My eligibility; use a separate All programs tab. Move ranking, recovery exports, and publishing to creator management.
- Use one lifecycle: Allocation published → Vault funded → Snapshot ready → Claim open → Claimed/Expired. Display only states supported by the underlying records.
- Avoid an initial page filled with empty ranking and recovery widgets when no snapshot exists; show a concise explanation and useful next action.

### Analytics, capital flow, burns, docs, and leaderboard

- Analytics: align period controls, units, freshness, and coverage. Separate protocol-wide figures from wallet-specific figures and token-specific figures.
- Capital flow: combine the calculator with a labeled allocation diagram and receipt history tabs. Keep examples visually distinct from recorded amounts.
- Burn page: distinguish voluntary burns, launch-promotion burns, and fee-funded buybacks. Explain why a supply reduction can differ from indexed burn-receipt totals. Format large balances with separators.
- Leaderboard: rank only available verified dimensions, state the period and formula, and hide unsupported points/next-reward widgets. Do not show “Top 100” as a headline when the available view contains one creator without an explanation.
- Docs: organize by user question—launch, trade, receive rewards, verify a receipt—then offer technical reference. Use the same product nouns as navigation.
- Move implementation strings such as database names, program versions, raw exception details, and internal worker names into a technical Details panel.

## Mobile, accessibility, and interaction acceptance

- Test 360, 390, 768, 1024, and 1440 CSS-pixel widths; include 200% zoom. No unintended horizontal page scrolling.
- Use a compact mobile header and four primary bottom destinations if usability testing supports them; account for safe areas and the on-screen keyboard.
- Keep labels on icons. Ensure readable numeric data and full-value access without requiring hover.
- Test keyboard order, visible focus, skip navigation, dialog focus trapping/restoration, Escape dismissal, and tab semantics.
- Measure text/control contrast; do not infer accessibility from the dark palette. Support reduced motion and avoid animated/reordering feeds that disturb focus.
- Use polite live announcements only for meaningful state transitions; do not repeatedly announce every market tick.
- Preserve scroll and filters on Back, provide explicit copy feedback, prevent duplicate submission, and make retry/resume paths specific to the failure.
- Test disconnected, wrong network, missing X connection, rejected signature, insufficient balance, unavailable quote, stale data, no records, partial coverage, and delayed indexing with safe fixtures.

## Implementation sequence

1. **Foundation:** shared tokens and components; terminology; page headers; badges; status vocabulary; numeric formatting. This prevents subsequent screens from drifting again.
2. **Main journeys:** navigation, compact Home/Explore, three-step Launch, token detail/trade hierarchy, Rewards overview.
3. **Secondary consolidation:** Portfolio, referral tools, airdrop management, analytics/capital flow, burns, docs, and leaderboard.
4. **Validation:** responsive and keyboard checks, representative loading/error states, regression checks for routes and financial labels, then Devnet workflow verification as a separate authorized implementation task.

For each phase, compare before/after screenshots of identical data states and viewports. Evaluate time to find a token, time to reach launch review, and time to locate a claimable reward. Establish baseline measurements before promising an improvement percentage.

## Source locations for follow-up work

- `index.html:30`: primary navigation.
- `index.html:67`: launch route introduction; `index.html:499`: second launch heading.
- `index.html:146`: homepage hero; `index.html:192`: homepage KPI grid.
- `index.html:278`: promotion copy referring to a verified badge.
- `index.html:354`: discovery sorting controls.
- `index.html:508`: token identity section; `index.html:529`: launch configuration.
- `styles.css`, `page-experience.css`, `ui-refinement.css`: overlapping visual layers.
- `page-experience.js`: presentation transformations that must be considered alongside static HTML.

Recommendations above preserve funded's fee policies and verification semantics. They describe proposed presentation and workflow changes; none are represented as implemented.
