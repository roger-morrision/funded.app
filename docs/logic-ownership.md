# Who does what: app services vs the on-chain program

The on-chain program is `funded-fee-router` (fee router with the developer-token escrow merged in). Mainnet runs one copy of it; Devnet also keeps the older standalone escrow for existing locks. Everything else is done by the app server, its workers and the browser.

Rule of thumb: the program holds funds and enforces the rules that decide where funds may go. The app computes, schedules, reads market data and keeps records.

## Launch

| Logic | Done by |
|---|---|
| Coin form, image/metadata upload, metadata storage | App |
| Launch service fee quote and collection | App (quote, receipt check); payment is a wallet transfer |
| Pump coin creation | Pump program (called by the creator's wallet) |
| Per-coin fee policy (category split, creator shares) fixed at launch | **Program** (`initialize_protected_mint_v3`) |
| Developer-token lock: 20% supply cap, 6/12/24/48 h deadline, single release to the creator | **Program** (`initialize_and_lock_for`, `release`) |
| Token-account (ATA) creation before custody | App (same transaction) |
| Launch review, anti-sniper and media policy | App |

## Creator fees and their split

| Logic | Done by |
|---|---|
| Detect accrued Pump creator fees, decide when to collect | App (fee-collector worker) |
| Collect creator fees into the coin's router | Pump program, triggered by the app |
| Split each collection into the 7 category vaults (80% creator, 20% shared) with exact rounding, once per claim | **Program** (`settle_mint_v3` / `_auto`) |
| Category spending limits (never more than paid in) | **Program** |
| Payout destination rules (creator wallet, reward vault, approved recipients; never another vault) | **Program** |
| Protocol recipients for operations and referral categories, frozen per coin | **Program** (`initialize_mint_automation_v3`) |
| Choosing when and how much to pay out | App |
| Fees paid in a token (USDC/xStock pairs): split and payouts | **Program** (`settle_mint_token_v3`, token approvals) |

## Buyback and burn

| Logic | Done by |
|---|---|
| Buyback budget (5%) locked with no withdraw path | **Program** |
| When to buy (trigger amount, wait time) | App (buyback worker) |
| Independent price check before a buy | Price-signer service; its signature is required by the **program** |
| Swap through the pinned $RICH pool and burn what was bought, atomically | **Program** (`buyback_mint_v3`) |

## Holder rewards, X rewards, daily bonus, airdrops

| Logic | Done by |
|---|---|
| Holder snapshots, time-weighted balances, eligibility (USD minimums, excluded wallets) | App (indexer, reward scheduler) |
| Reward amounts and Merkle tree | App |
| Daily bonus ranking and amounts | App |
| X account link and claim verification | App |
| Commit a reward cycle (root, total, payout time) and reserve its funds | **Program** (`create_reward_cycle`) |
| Proof check, one payment per recipient, never more than the cycle total | **Program** (`payout_reward_*`) |
| Release an unpayable cycle after the grace period | **Program** (`expire_reward_cycle`), triggered by the app |
| Community airdrop: snapshot approval, claims with proof, expiry, remainder | **Program** (community drop instructions); snapshot built by the app |

## Referrals

| Logic | Done by |
|---|---|
| Referral links, levels and eligibility | App |
| Referral budget per coin and payout limits | **Program** (categories 2-4) |
| Referral payout amounts and timing | App |

## Trading, discovery and the rest of the product

| Logic | Done by |
|---|---|
| Buy/sell quotes and routing (Pump, PumpSwap, Jupiter) | App + those programs |
| 1% app trading fee | App (added to the trade transaction, checked from the receipt) |
| Token discovery, market data, charts, holders | App (DexScreener, Jupiter, GeckoTerminal, Birdeye) |
| Paid listings, boosts, calls, chat, favorites, notifications | App |
| Service fees, boost prices, app limits (admin page) | App (each change needs the emailed admin code) |

## Admin and treasury

| Logic | Done by |
|---|---|
| Admin sign-in (wallet + JWT) | App |
| Emailed OTP code for every admin change and withdrawal | App |
| Treasury withdrawal caps (per withdrawal, per 24 h); optional second approver | App + internal signer service |
| Holding private keys and refusing disallowed transactions | Internal signer service (no public port) |
| Outflow and authority-change alerts | App (watcher, email) |
| Router authority rotation | **Program** (needs old, new and upgrade-owner signatures) |

## Mainnet-only program guard

| Logic | Done by |
|---|---|
| Pause all authority actions (guardian key) | **Program** (`set_protocol_pause`) |
| Daily SOL outflow cap for authority-approved payouts | **Program** |
| 24 h review delay before a reward cycle can pay; guardian cancel | **Program** (`cancel_reward_cycle`) |
| Planning payout times past the delay, committing cycles early | App |

## AI agency and token conversion (Devnet and Mainnet)

| Logic | Done by |
|---|---|
| AI agency budget (category 7), agent targets and milestones | **Program** (agency policy, rules and config) |
| Agent selection, market-cap observation, when to buy or promote | App (agency workers) |
| Agent buybacks | **Program**, with the independent price signer |
| Promotion billing (one receipt per post, interval enforced) | **Program** (`bill_agency_promotion_v3`); posting is done by the app |
| Agency payouts | **Program**; on Mainnet also paused by the guardian and counted against the daily cap |
| Token-budget conversion (paired coins' buyback/agency budgets to SOL) | **Program**, through reviewed pinned pools; on Mainnet it also needs the independent price signer |
| Which Mainnet conversion pools are allowed | Build setting `FUNDED_MAINNET_CONVERSION_POOLS` (empty until pools are reviewed) |
