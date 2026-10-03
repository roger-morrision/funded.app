# Ansem UI comparison — 2026-09-30

Reference: https://ansem.io/ (desktop review). Local preview: `http://127.0.0.1:5173/` on Solana Devnet. Verification here is **local-only** and compares layout and controls, not token data or transaction outcomes. No wallet signed or sent a transaction during this review.

| Reference | Local route | UI covered locally | Product-specific limit |
| --- | --- | --- | --- |
| [Home](https://ansem.io/) | `#overview` | Bull hero, launch and Index actions, trending strip, tier and stage filters, grid/table switch, protocol figures, FAQ, footer | Feed shows confirmed funded.vip Devnet launches; absent data remains unavailable. |
| [$ANSEM](https://ansem.io/ansem) | `/funded` / `#paid` | Token hero, live token figures when verified, tier figures, story, contract copy, protocol links | Figures use the verified Devnet pool and mint. |
| [Burn](https://ansem.io/burn) | `#buybacks` | Buy and burn forms, wallet position, side-by-side tier guide, why-burn section, receipt ledger | Boost/Pro/Premier burns are bound to a new launch transaction. A standalone burn does not unlock a launch tier. |
| [Z500](https://ansem.io/z500) | `#explore` | Index hero and three explainers, stage and tier filters, MC and age filters, 11-column table, pagination and coin links | Trade windows use bounded confirmed Devnet observations. |
| [Leaderboards](https://ansem.io/leaderboard) | `#leaderboard` | Burners, Burn Board, Creators, and Traders tabs; verified board and proof links | Trader ranks show an explicit unavailable state until wallet-attributed trades are indexed. |
| [Airdrop](https://ansem.io/airdrop) | `#airdrops` | Wallet gate, on-chain claim area, upcoming/distributed directory, search, pagination, holder guide | Claim actions require a funded vault, eligibility snapshot, and verified proof. |
| [Get Listed](https://ansem.io/list) | `#list` | Earlier review only; excluded from the follow-up requested here. | Payment pauses when the public listing index is unavailable. Address-format validation alone does not verify a token mint. |
| [Create](https://ansem.io/launch/create) | `#launch` | Tier cards, token details, media and social fields, live summary, cost review | The local flow uses three review steps and Devnet signing gates. |
| [Docs](https://ansem.io/docs) | `#docs` | Topic sidebar, grouped articles, next-topic navigation, direct links | Text describes funded.vip policy and current Devnet evidence. |
| [Coin detail](https://ansem.io/launch/coin/zj1jpp7QMveWHLs61vL9KMZf254KvW7j4AAmBF8ry2k) | `/token/:mint` | Artwork/identity header, profile tabs, market strip, chart range and units, trade panel, transaction record | The chart uses confirmed observations, not historical candles. Empty media uses a token-symbol treatment. |
| [Wallet profile](https://ansem.io/wallet/ETroz4qu4C6E9HJvYx8G3RjwwhtffSLaBy3yPjYm8THL) | `/wallet/:address` | Wallet summary, activity/created tabs, activity type filters, proof links | Activity is limited to verified Devnet launches and bounded trade scans. |

## Interaction review in this pass

I navigated the reference Home, `/launch` (the Home feed alias), Z500, Leaderboard, Airdrop, Create, $ANSEM, Burn, Get Listed, Docs, coin detail, and wallet profile pages. I exercised Home tier and stage filters, trending windows and carousel, settings switches, grid/table view, and MC sort; Z500 explanation popups, minimum-cap and age selectors, order switch, and Boost popup; Airdrop status, search, and pagination; Create tier explanations; coin trade settings; and wallet activity views. I inspected the remaining visible controls and links without triggering wallet signing, external trades, or listing payments. The local browser check exercised the new Home and coin controls.

| Interaction | Local result | Limit |
| --- | --- | --- |
| Home live order pause/resume | Added a control that keeps the currently displayed mint order across feed refreshes; manual filter and sort changes establish a new order. | Market values can still update while ordering is paused. |
| Home trending carousel and table MC header | Added back/forward buttons that track scroll availability. The MC header selects market-cap sort; pause is disabled in this static order. | Short trade windows remain unavailable where the feed has no verified window data. |
| Desktop home navigation | Leaderboard, Airdrops, and Get Listed now appear as direct header links at desktop width. | Smaller widths use the compact navigation. |
| Home feed settings | Added animation toggle and compact settings popup. | The feed lacks a verified content-sensitivity label, so there is no functional NSFW filter. |
| Home grid/table, tiers, market-cap and age filters | Present with the reference's seven table columns. | Only verified Devnet launches and available market fields render. |
| Index MCAP/BOOSTED and per-coin paid Boost dialog | Reviewed the reference interaction. Local sort and tier filters use verified market and launch policy; no paid Boost package is offered. | Paid Boost placement needs an implemented and auditable payment/indexing route. |
| Create tier About popup | Added one for Standard, Boost, Pro, and Premier with the configured burn amount and the local benefit policy. | Pro/Premier spotlight eligibility is a review, not guaranteed placement. |
| Coin quick buy amount popup | Added editing, reset, validation, and device-local storage for six SOL shortcuts. | Saving a shortcut does not sign or submit a trade. |
| Reference Get Listed mint lookup | A known public mint resolved to its token card, but the reference showed “Listings paused.” | The payment choice and submission state could not be exercised on the reference during this visit. |
| Airdrop tabs/search/pagination, leaderboard tabs, docs topics, coin chart/trade options, wallet activity | Matched where supported by local verified data and UI state. | Wallet-attributed trader ranks, historical candles, claim proofs, and some profile activity remain unavailable until indexed. |

## Verification in this pass

- Browser screenshots compared Burn, Create, and coin detail after their content loaded.
- The Burn tier guide reads configured launch tier amounts and does not count standalone burns as tier progress.
- `npm.cmd run build` passed after the interaction changes. `npm.cmd run verify:workspace-ui` passed 168 checks with 0 failures. See `docs/ui-evidence-2026-09-29/results.json` for the local-only results.

## Follow-up interaction pass — Get Listed excluded

I revisited the Home/index controls, $ANSEM contract copy, Burn project selector and wallet gate, Z500 Boost details, all four Leaderboard tabs, Airdrop search and status tabs, Create form sections, Docs topic navigation, coin detail trade controls, wallet profile tabs and activity filters, and the support topic popup. Wallet signing, external trading, paid Boost, and claim submission were outside this UI pass. The reference Get Listed page was not revisited.

- The reference global search opens with top coins, filters by name/ticker/mint as text changes, and supports arrow keys and Enter. The local shared search now shows **verified Devnet launches only**, with matching suggestions, keyboard selection, and direct token links. An unmatched query opens the Explore results.
- Local index dialogs now close when a hash route changes, so they cannot cover a newly selected page.
- The Home FAQ now includes a support path for mismatched records, and the footer links directly to Burn and Leaderboard.
- The reference support popup offers topic buttons and messaging. The local floating Help panel mirrors topic discovery and links to current Devnet guidance. It explicitly says live messaging is unavailable, since no support transport is connected.
- The reference on-chain Airdrop directory has claim-state filters, search, and its own pagination. The local Devnet claim area stays gated by verified vault funding, snapshots, and proofs; the launch allocation directory has its own status, search, and pagination controls.

## Remaining data-backed work

Historical candles, wallet trader rankings, airdrop claims, and paid listings need their respective verified indexes or proofs. The UI marks these states as unavailable or pending rather than showing example market activity as live data.

## 2026-10-01 interaction refresh

Reopened the live Home, $ANSEM, Burn, Z500, Leaderboard, Airdrop, Get Listed, Create, Docs, coin detail, and wallet profile routes. Exercised Home feed settings; all four Leaderboard views; Create's Gold explanation; Get Listed's invalid and recognized mint lookup; and wallet Created/Activity and Buy views. Checked the visible controls and states on the remaining routes against their local counterparts. The reference Get Listed flow currently says **Listings paused** for a recognized mint, so no payment state was tested. No wallet was connected, and no trade, burn, claim, listing payment, or launch was signed.

The local Index quick market-cap selector now opens its advanced filter when **MC · custom** is chosen and focuses the USD amount input. This closes a dead-end in the local filter UI. Home feed settings now show the reference's NSFW setting in a disabled state with the reason visible: no Devnet content-classification signal is available. Local-only browser checks confirmed the focus, filter selection, and settings state. The build passed; `verify:workspace-ui` passed 176 checks with 0 failures.

Reference features that require different product infrastructure remain scoped to their verified local equivalents: paid Boost placement, a second Get Listed payment method, mainnet historical candles, indexed wallet-wide trader ranks, and funded claim proofs. The pages expose the available Devnet evidence and do not represent these as completed transactions.

## Get Listed follow-up

The live [Get Listed](https://ansem.io/list) form resolves a pasted mint into a token preview, then marks an already indexed coin as listed. The local Devnet page now resolves mint metadata through `/api/listings/mint/:mint` or an on-chain verified listing record, displays a compact name/ticker preview, and links an already listed mint to its token page and burn proof. The former manual name/ticker fields are retained only as read-only internal form values. Changing the mint clears the prior token and payment status immediately. Invalid, unsupported, or unavailable metadata keeps payment review hidden; the server still rechecks mint metadata, wallet balance, and the burn before any transaction.

Local-only browser review checked an existing verified Devnet listing and an unsupported address. The UI suite also used a **mocked** metadata response to verify the lookup transition and payment gate without signing. The production build passed and `verify:workspace-ui` passed 177 checks with 0 failures.

The basic reference coin profile uses **About** and **Updates** tabs. The local coin profile initially uses those two tabs as well. Final verification for that pass included a production build, 178 workspace UI checks, and coin-detail fee activity checks.

## Airdrop and Leaderboard follow-up — 2026-10-01

Rechecked the live Airdrop launch tabs, search, and pagination, and the Leaderboard Burners, Burn Board, and Creators views. The local Airdrop directory now follows the reference's status tabs and search without an extra sort menu. Upcoming policies say allocation is available after a snapshot; a verified active drop asks the wallet to connect before checking its allocation. The active-drop detail no longer shows a redundant disabled claim button beside that check action.

The local Creators board now uses one row per confirmed Devnet launch (up to 25) with the reference's Rank, Creator, Market cap, and Launched columns. Creator and token names link to their local profiles. Market caps are ordered using the verified curve or pool value and an available SOL/USD rate; missing values remain unavailable. The earlier wallet-grouped creator count and duplicate builder panel were removed from this view. This was a **local-only** UI review; no wallet was connected and no claim or burn transaction was submitted. The production build passed, and `verify:workspace-ui` passed 225 checks with 0 failures.

## Create and Docs follow-up — 2026-10-01

The live Create form places launch tiers before coin details, marks description and social links optional, recommends square artwork, and warns that launch metadata cannot be changed after creation. The local launch flow already places tier choices first. Its Quick Setup wording now explains that collapsed optional values still publish at launch, and the token fields warn that the identity and entered story cannot be edited in this creation flow afterward. Description is marked optional, and image guidance recommends square artwork while retaining the local 12 MB preparation limit. The Launch guide repeats the metadata review rule. The production build passed, and `verify:workspace-ui` passed 225 checks with 0 failures. This comparison was **local-only**; no wallet was connected and no token was created.

## Coin profile content tabs — 2026-10-01

The live [Bullshit Coin profile](https://ansem.io/launch/coin/zj1jpp7QMveWHLs61vL9KMZf254KvW7j4AAmBF8ry2k) shows **About**, **Updates**, **Roadmap**, and **Links**. Roadmap has its own panel, and Links lists project supplied destinations with a caution about their provenance. The local Devnet profile now shows Roadmap when matched signed metadata contains roadmap text and Links when it contains valid HTTPS social or website URLs. Sparse profiles keep only About and Updates. Changing tokens clears optional content and returns to About if a removed tab was active. Header links remain as quick actions, matching the reference profile.

This was a **local-only** UI change. The production build passed. The built preview passed 228 workspace UI checks with 0 failures, including a **mocked** signed metadata transition, optional tab keyboard navigation, and reset behavior. No wallet was connected or transaction signed.
