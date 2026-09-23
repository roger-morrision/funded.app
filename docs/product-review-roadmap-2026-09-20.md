# funded.vip product review and phased roadmap

Review date: 20 September 2026. Scope: current funded.app checkout, local preview at `127.0.0.1:5174`, selected local API responses, and current public competitor documentation/pages. This is a recommendation document, not an implementation or production-readiness certification.

## Recommendation

Build **the simplest way for a creator community to launch a coin, understand who receives its fees, and verify actual payouts**. Do not position the product as a collection of tokenomics dashboards, or promise that all participants will profit.

Start with existing Solana creators and community operators who already have an audience. Validate their willingness to use and pay for accountable fee distribution before targeting the general public.

The current app has useful safety foundations but too many visible destinations, overlapping explanations, and unfinished financial experiences. The biggest improvement is subtraction: four primary destinations, one default creation path, one understandable rewards balance, and one persistent transaction history.

Keep the existing Pump integration for the alpha. Evaluate LaunchLab as a bounded technical decision after the core flow works. Do not expose a protocol-selection question to new users.

## Evidence and limits

- **Browser observed:** overview; launch entry and first wizard step; Explore; Payments; Analytics; My launches; Referrals; Community; Leaderboard; Airdrops; Buybacks; Capital flow; Docs; Profile; Privacy; $FUNDED; one registry-linked token detail; and its linked wallet detail. Inspected token and launch layouts at 390 × 844 as well as the default desktop viewport.
- **Source reviewed:** remaining launch steps, initial purchase, transaction construction, signing/recovery, trade quote and execution, wallet adapters, fee policy, X claims, referrals, chat, receipts, route handling, readiness checks, and legal/opt-out dialogs. This is not an exhaustive security audit or an end-to-end execution of every control.
- **Runtime observed:** `/api/x-fee/status` returned 404 through port 5174 and directly on 8799, while current source defines that route. `/api/readiness` through 5174 returned `blocked`, listing production RPC, keeper, reward program, community vault, and X attestation as missing. These observations apply to this local preview, not an independently inspected public production deployment.
- **Local-only checks passed:** `verify:launch-wizard`, `verify:mint-router-v2`, `verify:receipt-evidence`, `verify:explore-discovery`, `verify:coin-detail`, `verify:production-policies`. These include source assertions and synthetic/mocked data; passing them is not proof of a real payout or a successful complete user journey.
- **Not exercised:** new coin creation, buys/sells, burns, X OAuth authentication, payout execution, real mobile-wallet handoff, mainnet, load testing, full keyboard/screen-reader audit, or moderated user studies. The preview auto-connected its configured development wallet; no launch, trade, payout, burn, or deployment was submitted for this review.
- The worktree already contained app changes. They were left untouched. Only this report was added.

## Findings to address first

| Priority | Finding and evidence | User consequence | Recommended change |
|---|---|---|---|
| P0 | Source/runtime mismatch: the X-fee status route exists in `server/index.mjs:580`, but the running preview returns 404. | A feature implemented in code may still be unavailable in the actual app. | Expose build/version and per-feature capability status; release compatible frontend/API versions together; run deployed smoke tests. |
| P0 | Settlement is not demonstrated as operational. Readiness is blocked; Payments shows unavailable receipt verification. | The main value proposition cannot yet be validated by users. | Prove collection → correct entitlement → correct recipient → confirmed receipt on Devnet before public financial launch. |
| P0 | Token safety panel is hidden by `.coin-page .coin-policy-card{display:none!important}` in `coin-detail.css:247`, while `page-experience.js:127` adds an “On-chain checks” button targeting it. | Important checks have a visible navigation affordance but no visible destination. | Restore accessible checks and give incomplete verification a distinct state. Keep critical authority/liquidity warnings visible near trading. |
| P0 | Token header labels the Pump curve creator as “by …”; for the inspected coin this is the funded router PDA, not the human deployer. `app.js:3049` and `app.js:3056` also call it a creator wallet. | Users may attribute ownership, reputation, or accountability to a program address. | Separate “Launched by”, “Fee recipient/router”, and “Verified social account”; populate each from its proper evidence. |
| P0 | Policy objects label distribution `automatically-settled-from-router` (`distribution-policy.js:93`), while UI disclosures say settlement is not live. The $FUNDED page contains both automatic-settlement copy and a not-live notice. | Contradictory expectations about whether funds moved or are merely planned. | Separate policy configuration, funded balances, obligations, claimability, submission, and confirmed payment across API and UI. |
| P1 | Thirteen sidebar destinations compete before a user has completed one useful action (`index.html:25`). | Navigation load and too many empty destinations. | Reduce primary navigation to Explore, Create, Portfolio, Rewards. Move protocol explanations to About/Help. |
| P1 | At 390 px, the create dialog spends most of the first screen on introduction, progress numbers, fixed route, and two setup-path cards; only the first input starts near the bottom. | Users must scroll before beginning a supposedly quick action. | Put name, ticker, and image first; default to Simple; collapse optional content. Prefer a full-page mobile creator flow. |
| P1 | There are both setup-depth choices and quick/custom policy choices, plus four wizard steps and burn tiers. | Users must understand the app's internal options before creating a coin. | One Simple/Advanced distinction. Move promotion/burn purchases out of the default launch path. |
| P1 | Mobile token pages show global Create/Invite/Community CTAs at the bottom, not the token's Buy/Sell actions. | The highest-intent action is buried. | Contextual sticky Buy/Sell bar, opening a quote/review sheet; never bypass confirmation. |
| P1 | Registry showed a named coin, but its detail rendered “Unnamed on-chain token” and a generic avatar. | Shared token pages lose identity and credibility during metadata failure. | Layer verified registry and metadata fallbacks, with provenance; keep identity useful even when a provider fails. |
| P1 | Explore temporarily showed RPC unavailable and zero matches while another page could show registry launches. Several screens use zero-like empty states for unavailable/indexer-pending data. | Outage, no results, and genuinely zero activity are easy to confuse. | Common typed data states: loading, empty, partial, stale, unavailable, verified. Retain last verified data with timestamp; never enable stale trade quotes. |
| P1 | Payments presents X account and Claim ID fields; the tested runtime does not expose the new status endpoint. | Users need internal identifiers and cannot confidently determine eligibility. | Discover claims after identity verification, auto-select the entitlement, and use one guided claim action. |
| P1 | Mandatory 3%+ community reserve is a policy record, not proof of funded custody. Both “reserve” and “locked” language appear. | Users may mistake a promise for tokens actually available to claim. | Label planned versus funded allocation; enable public claim promises only after verified funding and eligibility proofs. |
| P1 | Initial-buy cap exists, but it only constrains the app's launch purchase. | “Max 20%” could be mistaken for a universal anti-whale or lifetime ownership restriction. | Say “Your initial purchase: up to 20% of total supply.” Explain that this does not prevent later purchases or purchases by other wallets. |
| P1 | Creation copy promises one Pump transaction (`index.html:354`); source can require router initialization plus launch, metadata signing, and policy signing. | Unexpected wallet prompts increase abandonment and phishing anxiety. | Show the actual approval plan before starting, distinguishing free message signatures from paid transactions. |
| P1 | Chat accepts a supplied author label and message at `server/index.mjs:646`; that handler does not verify that the label belongs to a wallet or creator. | Impersonation and spam can undermine an otherwise proof-focused product. | Authenticate posting, distinguish unverified guest names, add reporting/moderation/rate limits, and never infer identity from display text. |
| P1 | Token links receive the general app HTML; no token-specific social-card metadata was found in the reviewed static-serving path or HTML. | A shared coin link lacks strong identity/context in social previews. | Server-render canonical token title, image, description, and safe Open Graph cards. |
| P2 | Basic route content appears after initialization rather than being immediately specific to a deep-linked token/wallet. | Shared links can initially look like the home page. | Route-specific shell first; load wallet, market data, chat, and rewards independently. |
| P2 | The `funded` suffix is not guaranteed: the current launch path uses `Keypair.generate()` (`launch-flow.js:93`). | Branding promise would exceed implementation. | Treat vanity mint provisioning as a later isolated feature, not a launch or safety guarantee. |

P0 means a release/trust blocker for a public financial product, not proof of an actively exploited vulnerability. Source findings need regression tests; observed UI states are point-in-time observations.

## Page-by-page disposition

| Current surface | Keep, merge, or defer | Desired user experience |
|---|---|---|
| Overview | Shorten; returning visitors go to Explore/Portfolio | One sentence explaining the benefit, two actions, a few genuine launches, and a plain network/status notice. Remove repeated policy essays and unavailable rankings. |
| Explore | Keep as primary | Search; New / Active / Following; a few clear metrics; useful empty/error states. Put comparisons, advanced filters, and scanners behind Advanced. Define ranking methodology. |
| Coin detail | Keep; highest priority | Identity, creator, price/liquidity, Buy/Sell, fee beneficiaries, activity, community updates. Separate market estimates from verified account facts. |
| Wallet detail | Merge into profile/address detail | Distinguish wallet from program/PDA. Show supported facts only; do not imply a full portfolio when only an address link is available. |
| Launch shell | Remove extra entry step | Opening Create should open the form directly, not another “Open launch console” page. |
| Launch wizard | Simplify | Details → Review → confirmation/progress. Advanced economics remain optional but irreversible choices must still be reviewed. |
| My launches | Portfolio → Created | Drafts, live launches, verification/registration problems, creator earnings, and exactly one recommended next action. |
| Payments | Rewards → Claims & history | Available, pending, paid; correct account/network; guided claim; transaction receipts. |
| Analytics | Creator detail / About → Transparency | Creator-relevant metrics first. Protocol totals only when complete enough to interpret. No decorative empty charts. |
| Community | Portfolio → Following | Sync follows after sign-in; show creator updates and opt-in alerts. A local watchlist should be called Following/Watchlist, not imply a social network. |
| Leaderboard | Defer as a primary page | Later reward legitimate contribution and returning communities, not raw launch count or easily fabricated trading volume. |
| Airdrops | Rewards → Distributions | Eligible claims first. Creator publishing tools live under the relevant coin. Hide unfunded programs from “claimable”. |
| Buybacks | About → Treasury | Policy, allocation, execution and burn receipts clearly separated. Not a beginner navigation destination. |
| Referrals + toolkit + FAQ | Rewards → Invites | One link, qualification rules, actual earnings. Advanced campaign breakdown only when useful data exists. |
| Capital flow | About → Fees & transparency | One readable worked example, correct denominator, real receipts linked separately. |
| Docs | Help | Task-based guidance: create, buy/sell, recover a failed launch, claim, report a scam. Searchable and linked at the point of failure. |
| Profile | Portfolio/settings | Wallets, verified identity, connected accounts, recovery, notification preferences, data controls. |
| Privacy / Terms / Disclosures / Opt out | Permanent, versioned Help/legal routes | Explain real data processing, authority/upgrade risks, exclusions and claims handling. The existing Devnet dialogs are not production agreements. Obtain appropriate professional review before rollout. |
| $FUNDED | About; defer acquisition upsell | Explain utility and actual execution honestly. Do not require a newcomer to acquire/burn another token before a basic launch. |
| Global search / notifications / wallet dialogs | Keep only useful controls | Search mints and names; state unsupported searches. Badge notifications only for actual events. A connected wallet is not a successful financial action. |

## Target navigation and core journeys

Primary navigation: **Explore · Create · Portfolio · Rewards**. Secondary: Help, About/Transparency, Settings. On mobile use the same four destinations, replaced by contextual trade actions when viewing a coin.

1. **Visitor:** open a shared token link → understand creator, purpose and risk → follow without funding a wallet → optionally review a trade. Browsing must not require sign-in.
2. **Creator:** enter name/ticker/image → optionally add story/socials and initial purchase → review exact cost, fee recipients and irreversible choices → approve clearly described signatures → see confirmed coin and any pending registration separately → share.
3. **Trader:** inspect token → enter SOL spend or sell percentage → preview output, minimum received, fees, slippage and route → approve → see confirmed transaction and refreshed balances. Rejecting a prompt is cancellation, not a red error claiming failure.
4. **X recipient:** open a claim deep link → sign in with the correct X account → view eligible amount and provenance → connect/verify receiving wallet → claim → receipt. Use stable X user IDs; linking a public profile is not proof of affiliation or endorsement.
5. **Returning user:** Portfolio shows holdings/created coins/following; Rewards shows money available and what is still pending. Notifications lead to a specific actionable item, not a generic dashboard.
6. **Interrupted transaction:** restore exact operation → show last confirmed step → check chain before retry → resume safely. Never create a second coin or pay again just because the UI lost its response.

## What to borrow from similar platforms

These are product patterns to adapt, not instructions to copy brands, proprietary assets, or every feature. Competitor interfaces and economics change frequently. This was a representative review, not an exhaustive audit of the entire market.

| Platform | Current source-backed pattern | Apply to funded.vip | Avoid copying |
|---|---|---|---|
| Pump.fun | Create page emphasizes name/ticker/media, optional description/socials, immutable-data warnings, and creator-versus-holder rewards. | Minimal first screen; plain language around irreversible choices; optional fields genuinely optional. | Assuming fee sharing is unique, or importing promotional trading modes as growth features. [Create page](https://pump.fun/create) |
| Raydium LaunchLab | Separate fast-default and configurable creation paths, optional initial purchase, review before approval. | One Simple default and one Advanced expansion. Explain initial-buy impact and post-launch progression. | Showing all curve/vesting/configuration choices to beginners. [Creation guide](https://docs.raydium.io/user-flows/creating-a-launchlab-token) |
| Clanker | Core identity fields, grouped token settings, optional creator buy/vault/airdrop, and a deployment summary. | Composable advanced options and an always-readable cost/recipient summary. | Adding autonomous engagement bots or multiple chains before moderation and one-chain reliability. [Deployment page](https://www.clanker.world/deploy) |
| Zora | Email-based onboarding with optional existing wallet; content-first creation; preset trade amounts and fee/output review. | Browse first; evaluate optional embedded-wallet onboarding later; easy media handling and familiar trade sheets. | Treating social engagement or token purchases as guaranteed earnings. [Accounts](https://support.zora.co/en/articles/4655425), [Creation](https://support.zora.co/en/articles/7988417), [Trading](https://support.zora.co/en/articles/7988801) |
| BONK ecosystem | Its public hackathon organized themed launches, rules and a community event. This is a historical example, not a current growth-performance claim. | Small creator cohorts and useful launch events with published selection criteria. | Market-cap contests, assumed organic adoption, or copying a historical campaign budget. [Official campaign page](https://hackathon.letsbonk.fun/) |

Important integration caveat: Pump's current holder-rewards documentation says that this mode redirects the creator-fee recipient to a Pump-controlled address; new cashback creation is deprecated. It is not a drop-in switch for funded's custom router. Preserve explicit route invariants and test SDK compatibility before enabling it. [Pump holder-rewards documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/HOLDER_REWARDS_README.md)

## Pump versus LaunchLab

**Near-term decision: keep Pump for the alpha.** The app already has Pump-specific mint verification, trading, graduation handling and transaction construction. Changing launch protocols does not fix information architecture, missing payout evidence or deployment mismatch.

**Strategic candidate: LaunchLab** if funded's central requirement is operating a branded launch platform with native platform configuration and structured launch options. Its platform model explicitly supports third-party branding and fee/migration configuration. Arbitrary X identity verification and funded's custom beneficiary accounting would still need their own design. [LaunchLab platforms](https://docs.raydium.io/products/launchlab/platforms)

Before deciding, build a separate Devnet comparison, not a user-facing protocol picker. Compare creation cost, packet sizes and approvals; creator buy at 0/1/5/20%; fee collection before and after graduation; recipient enforcement; SDK change risk; indexing support; recovery; and total ownership cost. Use real confirmed deltas, not “transaction submitted”. Do not assume launches automatically receive discovery placement or an audience through either integration.

Raydium's current detailed documentation distinguishes CPMM creator fees from platform-owned locked-LP Fee Keys and records changed migration behavior. Some creation-guide text still mentions legacy creator Fee Keys. Reconcile current config/IDL and Devnet behavior before promising post-graduation rights. [Creator-fee mechanics](https://docs.raydium.io/user-flows/how-creator-fees-work)

## Phased delivery plan

The gates below are proposed acceptance targets, not measured conversion rates or forecasts. Phases are dependency-ordered; calendar estimates would require team capacity and ownership. Phase 1 design can run alongside Phase 0 reliability work. Public financial rollout waits for the Phase 0 and Phase 2 gates.

### Phase 0 — Truth, identity and reliable releases

**Outcome:** users can distinguish what exists, what is safe to attempt, and what actually happened.

- Resolve frontend/API version mismatch; publish build ID, network, program version, and feature capabilities. A missing endpoint must produce a useful unavailable state.
- Restore on-chain checks; fix human creator versus router attribution. Replace broad “verified” labels with the exact verified fact.
- One data-state model and one feature-status source across pages. No zero balances when the balance query failed; no “automatic payout” claim based only on a policy.
- Persistent transaction journal: draft, prepared, awaiting approval, submitted, confirmed, verification pending, registration pending, completed, failed/cancelled. Include retry guidance and explorer links.
- Expand packet-size regression coverage across normal/max metadata, burns, initial-buy percentages and router modes. Preserve atomic paid burn + creation; if a combination cannot fit, block it before wallet approval. Keep estimation and submission on the same planner. Renew expired blockhashes safely between steps and reconcile prior signatures before retrying.
- Secure chat identity and abuse controls before promoting it. Remove unverifiable creator badges.
- Replace host-dependent production metadata with durable storage, provenance checks and retention commitments. Preserve signed original metadata separately from versioned community updates.
- Add release tests for deep links, capability responses, actual deployed assets and critical API contracts; test database backup/restore and rollback.

**Gate:** all public critical routes/control targets resolve; no known false payout/creator claims; valid supported launch combinations fit or are blocked pre-signing; failures preserve recoverable state; deployed build/version matches the tested release. Devnet uses safe test fixtures and ephemeral wallets.

**Owners:** engineering + QA; security review for financial state/authority changes.

### Phase 1 — The small, understandable product

**Outcome:** a new user can understand and complete the core tasks without learning the protocol's internal vocabulary.

- Consolidate navigation and pages as above. Keep a clear Devnet banner in the preview.
- Create opens directly into a short form. Default Simple; collapse socials, milestones and custom beneficiaries. Optional presets must never silently change immutable economics.
- Make image upload friendly: preview, crop, automatic compression within supported limits, inline errors, accessible remove/replace. Do not ask users to manually make an image smaller than 600 KB.
- Keep initial buy off by default. Offer SOL-spend input with an estimated percentage of total supply, or a clearly labeled percentage input. Enforce the existing 20% limit using integer token amounts; show maximum spend, price impact, balance headroom and live quote validity.
- Review separates token supply, initial purchase, fee shares and community allocation. “20% of supply” and “20% of creator fees” must never appear interchangeable.
- Make signature counts truthful: metadata/policy authorization messages versus network transactions, with purpose and cost for each.
- Mobile: full-height flow, sticky next/review actions, readable type, suitable touch targets, safe-area spacing and no double-scroll trap. Name progress steps accessibly even when visual labels shrink.
- Token page: contextual Buy/Sell; compact amount formatting; clear estimated cap versus liquidity; visible authorities and beneficiary summary; useful metadata fallback. Advanced trade scans and address filters are secondary.
- Replace “Settlement rail”, “creator-directed”, “PDA” and “gross claim” in beginner copy with plain explanations; keep technical details in expandable evidence.
- Add task-focused help, empty states with a next action, and durable support links. Preserve drafts without silently persisting images or sensitive information.

**Gate:** in a proposed study of 20 representative users, at least 16 complete the create-draft → review task without assistance, and at least 18 correctly identify network, cost, fee recipient and initial-buy amount. Test at 360/390/768/desktop widths, keyboard navigation, focus, screen readers, and mobile wallet handoff. Median draft-to-review target: under two minutes, excluding wallet funding and network confirmation.

**Owners:** product/design + frontend + QA.

### Phase 2 — Make rewards genuinely useful

**Outcome:** one creator/beneficiary can understand, receive and prove the correct payment.

- Prove the complete per-mint fee lifecycle on Devnet, including post-graduation behavior, no-fee/no-balance cases, identity mismatch and historical shared-router ineligibility.
- Review settlement authority and upgrade controls independently. Publishing an immutable signed policy is not the same as on-chain enforcement of every recipient and percentage. Document which guarantees depend on a trusted service.
- Build one Rewards screen: Available to claim, Pending verification, Paid. Explain why an item is pending and whether the user can fix it.
- Replace manual Claim ID entry with identity-scoped discovery/deep links. Stable X ID, original obligation, correct network, wallet binding, and prior payout must all agree.
- Make wallet binding/recovery understandable before it becomes immutable. Specify lost-wallet, compromised-account, renamed-X-handle and deleted-account behavior; recovery must not permit redirection by an attacker.
- Separate authorization/challenge expiry from ownership of earned funds. Make renewal safe and explicit; do not erase an earned entitlement just because a short signing window expired.
- Provide idempotent settlement with leases/reconciliation for interrupted workers and response timeouts. Rebuild displayed totals from verified receipts; never pay twice on retry.
- If “claim all” is added, use a clear per-item result and continuation for partial batches. Never hide fees or failure behind one success toast.
- Either implement and fund community rewards with verifiable custody/proofs or remove them from the available launch promise. Do the same for buyback execution.
- Production readiness must test actual dependencies, balances, authorities and receipt flow, not just whether environment variables exist. Prepare durable sessions, key custody, alerting and incident procedures.

**Gate:** every paid test entitlement has a matching source collection, calculation, approved recipient, successful transaction and expected recipient delta; reconciliation balances exactly; replay/unauthorized/redirection tests fail safely; interruption recovery does not duplicate payments. Independent security review and applicable launch/compliance review are complete before mainnet activation. This review did not establish that gate.

**Owners:** backend/on-chain engineering + security + operations.

### Phase 3 — Give people a reason to return

**Outcome:** creators maintain useful communities and users return for information, not merely incentives.

- Launch with a small opt-in cohort of creators who already have communities. Interview both creators and their visitors; measure reasons for abandonment.
- Portfolio: Created, Holdings when accurately indexed, Following, Activity. Avoid presenting partial wallet scans as complete balances or profit/loss.
- Creator pages: verified authorship, purpose, official links, versioned updates, milestones, and verified fee receipts. Explain that authorship verification does not certify investment quality.
- Follow creators/tokens without forcing a trade. Sync across devices after optional account linking.
- Opt-in notifications for genuinely actionable events: confirmed reward, launch recovery required, creator update, graduation. Frequency controls, digest and unsubscribe; no manufactured urgency.
- Moderated discussion with report/block controls, scam-link warnings and creator impersonation protection. Default off until abuse operations are ready.
- Sustainable discovery: fresh activity, relevant follows, useful updates, adequate data coverage; clearly labeled sponsorship. Do not rank purely by wash-tradable volume or paid burns.

**Gate:** cohort evidence of repeated non-incentivized use across at least four weeks. Proposed starting targets: at least 25% D7 retention among activated users and at least 30% of pilot creators publish a useful second update within 14 days. Establish baselines first and revise targets from evidence, not vanity dashboards.

**Owners:** product + community/support + data/backend.

### Phase 4 — Sharing loops that deliver real value

**Outcome:** users voluntarily bring other appropriate users because the shared object is useful.

- Token launch cards with image, purpose, verified creator, network and canonical link. Provide user-controlled share/copy; no automatic posting to X or group spam.
- Optional payout receipt cards with confirmed amount, date and proof link. Never present one payout as a typical earning or guaranteed return; let users keep amounts private.
- Creator update cards and embeddable launch/receipt widgets. Server-render social previews; sanitize media/links and use durable URLs.
- Claim invitation loop: recipients visit to verify an actual entitlement, receive understandable help, and can follow the creator afterward. No bait claims or forced reposts.
- Begin with a simple direct-referral explanation and collected-revenue qualification. If changing three-level economics, do so only for explicitly accepted future policy versions; preserve historical signed obligations. Add Sybil/self-referral controls and a bounded incentive budget.
- Creator launch kits and small themed cohorts. Measure whether invitees retain, not simply whether a campaign generates clicks or mints.
- Earned distribution through creator communities and educational content; explore partnerships after there is product proof. Paid acquisition only after support costs, fraud and retention are understood.

**Gate:** measure share → unique landing visitor → activation → retained activation by cohort and source; reward cost is covered by realized unit economics; no reward for fabricated volume or recruitment alone; abuse/support load stays manageable. Scale experiments only when incremental retained users are demonstrated.

**Owners:** growth + product + community + fraud/data.

### Phase 5 — Scale the proven product

**Outcome:** greater traffic does not degrade correctness, trust or support.

- Move production availability off a desktop-dependent hosting arrangement; managed runtime/storage, backups, rehearsed restore, observability and incident response.
- Index confirmed events once server-side; paginate feeds and histories; cache shared read models; deduplicate requests and use bounded refresh/backoff. Do not multiply RPC scans for every browser and route.
- Independent wallet, quote, market, chat and receipt services/queues as needed; idempotent workers, dead-letter queues, reconciliation and bounded concurrency.
- Route-level code splitting and modular frontend ownership. Replace DOM text-rewriting/CSS overrides with shared semantic components and tested state contracts as features are touched; avoid an unrelated framework rewrite.
- Load test realistic concurrency, queue depth and RPC quotas at multiples of observed peaks. Gate on latency, error rate, freshness, recovery and infrastructure cost per active user—not user-count labels.
- Evaluate optional embedded-wallet/email/passkey onboarding only with explicit custody, export, recovery and provider-risk decisions. Add fiat funding only through suitable vetted providers and jurisdiction-specific review.
- Localization and accessibility from actual demand; mobile web/PWA before assuming a native app is required.
- Vanity `funded` mint inventory only if demand justifies cost: secure generation, reservation, one-time consumption, exhaustion behavior, and provenance. Never represent a suffix as evidence of safety. Do not block a basic launch on expensive synchronous grinding.
- Consider LaunchLab support or public APIs only when a measured user requirement justifies the maintenance and security cost.

**Gate:** agreed service objectives met under representative load and failover drills; accurate financial reconciliation maintained; independent review complete; positive contribution margin at the intended scale; support and moderation staffing adequate.

**Owners:** platform/operations + security + data + support.

## Economics and benefits: be explicit about the tradeoffs

The current policy sends 80% of collected creator fees to configured creator-directed destinations and 20% to app programs. Within the gross creator-fee amount, that is 14% operations, 3% referrals, 2% community, 1% buyback. Separately, the app's trade-fee default is 50 basis points in `pump-trading.js`; actual configuration and upstream protocol fees must be quoted at execution.

These are different fee bases. A 20% creator-fee share does **not** mean a 20% tax on every trade. Conversely, the added trading fee must not disappear behind the 80/20 explanation. Show all-in cost before signing and evaluate whether users receive enough service to justify both revenue streams. Do not double-count program allocations as additional income.

| Participant | Useful benefit to deliver | Guardrail |
|---|---|---|
| Creator | Easy launch, dependable fee collection, clear community page and recovery | No guaranteed demand or earnings; know fee ownership and upgrade/service dependencies. |
| Trader/supporter | Understandable quote, useful discovery, visible risks and proof | Real liquidity/impact data; selling is as accessible as buying; no pressure to trade. |
| X beneficiary | Discover and claim a verifiable entitlement | Stable-ID proof and safe wallet binding; being named does not imply endorsement. |
| Community recipient | Transparent funded eligibility and receipts | No promise based only on a future reserve policy. |
| Referrer | Transparent reward from genuine collected activity | No recruitment-only rewards, hidden conditions or incentivized wash trading. |
| Platform | Sustainable revenue for reliability, security and support | Track infra, RPC, settlement, fraud, support, incentives and compliance costs. |

Do not promise “best benefits for everyone” as profit. Trading can produce losses, fees reduce proceeds, and rewards need a real funding source. Optimize for transparent terms, user control and reliable delivery instead.

## Growth measurement and the million-user ambition

Define the goal first: one million registrations, one million wallets and one million monthly active people are very different outcomes. Prefer retained, non-abusive active users, with privacy-conscious measurement. Wallet count is not person count.

Primary product metric: **weekly retained users completing a meaningful task**—a verified launch/claim, a viewed followed-creator update, or another deliberate useful interaction. Count trading separately, and do not pressure people to trade to improve activation.

Track:

- Acquisition: qualified unique visits and source; bot-filtered where possible.
- Activation: draft → review; valid approval attempt → confirmed result; eligible claim view → paid receipt; follow → return.
- Reliability: quote freshness, confirmed outcomes, unknown outcomes, recovery rate, wrong/duplicate payouts, index lag.
- Retention: D1/D7/D30 by creator, follower/trader and beneficiary cohorts; incentive versus non-incentive cohorts.
- Growth: share rate, unique referred visits, retained referred users, creator cohort retention.
- Sustainability: net realized revenue minus incentives, RPC/hosting, sponsored fees, fraud losses and support costs.
- Harm/trust: scam reports, impersonation incidents, complaint resolution, disputed claims, confusing-fee reports and notification opt-outs.

Illustrative planning only: 10,000 participating creators × 100 unique activated visitors each gives one million activations **before** audience overlap, bots and churn. It does not imply one million retained users. A useful referral measure is invitations per active user × invite-to-activation rate × retained share of those activations. Measure each factor; do not assume a viral coefficient above one.

Start with roughly 20–50 creator communities; improve the measured bottleneck before expanding cohorts. Establish product fit and sustainable service first, then acquire traffic. No interface or feature set can guarantee virality.

## First implementation batch

1. Release/version and capability alignment; clear blocked X-claim state.
2. Restore token checks and separate creator identity from router authority.
3. Unify data/payout status language and correct contradictory automatic-settlement copy.
4. Four-destination navigation and contextual mobile token actions.
5. Short Simple create form, automatic image preparation, accurate approval/cost plan.
6. Packet-size, cancellation, partial-success and recovery regression matrix.
7. End-to-end Devnet payout proof before marketing creator earnings.
8. Identity-preserving token detail and server-rendered share cards.
9. Authenticated/moderated community interaction before growth promotion.
10. Instrument task funnels and run the first moderated user study.

Defer paid-burn tiers as an acquisition hook, extra chains, autonomous social bots, expansive leaderboards, native mobile apps, complex referral expansion, and mandatory vanity suffixes. They add cost and complexity before the core value has been proven.

## Source map

Local entry points (line references describe the reviewed snapshot and may move):

- [Navigation and creation UI](C:/Data/DevApps/funded.app/index.html:25)
- [Frontend route/state and claims](C:/Data/DevApps/funded.app/app.js:2896)
- [Hidden token checks](C:/Data/DevApps/funded.app/coin-detail.css:247)
- [Presentation additions](C:/Data/DevApps/funded.app/page-experience.js:127)
- [Launch purchase and execution](C:/Data/DevApps/funded.app/launch-flow.js:45)
- [Packet-size planner](C:/Data/DevApps/funded.app/mint-router-launch.js:1)
- [Fee distribution policy](C:/Data/DevApps/funded.app/distribution-policy.js:1)
- [Trading fee and quote logic](C:/Data/DevApps/funded.app/pump-trading.js:1)
- [API X readiness](C:/Data/DevApps/funded.app/server/index.mjs:338)
- [Chat handler](C:/Data/DevApps/funded.app/server/index.mjs:646)
- [Receipt verification](C:/Data/DevApps/funded.app/server/receipt-evidence.mjs:1)
- [Readiness configuration checks](C:/Data/DevApps/funded.app/production-readiness.js:1)

Competitor sources are linked beside the relevant findings. No competitor transactions, authenticated flows, conversion rates, market-share claims, or payout performance were independently tested in this review.
