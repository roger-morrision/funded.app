# funded.vip

A Solana Devnet application for launching and discovering tokens, inspecting V3 creator-fee routes, and tracking verified rewards. Mainnet activation is a separate reviewed release.

## Approved referral update

The approved new referral policy totals **1% of gross collected creator fees**:
**L1 0.6667% · L2 0.2% · L3 0.1333%**. The other 2% moves to the dedicated AI
agency allocation. The referral overview, FAQ, Help and Docs identify this as
pending until the eight-category V3 agency policy is activated. Existing coins
and recorded payments retain their saved rates.

## Published deployment policy before agency activation

The current new-launch default, as a percentage of **gross creator fees collected**, is:

| Destination | Gross share | Meaning |
| --- | ---: | --- |
| Creator-directed | 80% | Saved split between the creator wallet, coin holders and a named X account |
| Operations & marketing | 8% | 40% of the protocol's fixed 20% |
| Referral network | 3% | Levels 1/2/3: 2% / 0.6% / 0.4% of gross |
| Daily bonus | 4% | Equal creator, direct-referrer and trader category pools |
| $FUNDED buyback | 5% | Dedicated V3 vault allocations for protected purchase and burn |

These are percentages of creator fees, not trade volume or every Pump fee. The protocol split is configured in [config/protocol-fee-split.js](config/protocol-fee-split.js); a saved admin policy overrides the build default for future launches. Existing coins and settlements retain their recorded on-chain category units. Collection, creator-approved settlement, source funding and finalized recipient payment are separate stages.

## Automatic rewards and claims

| Program | Asset | Recipient action |
| --- | --- | --- |
| Creator wallet | SOL | Review and sign available settlement, funding and payout actions |
| Coin holders | SOL | Automatic after complete eligibility, funding and minimum checks |
| X account | SOL | Named account signs in, links its recipient wallet and claims |
| Referral network | SOL | No recipient claim; creator-approved transfers pay the frozen upline |
| Daily bonus | SOL | Automatic after completed-day snapshot and exact source funding |
| Community airdrop | Launched coin tokens | Eligible wallet checks its proof and claims within the displayed window |

Standard holder rewards use hourly periods and five-minute finalized samples. Selected Devnet QA coins can use five-minute periods and reduced minima. Check each coin's actual program conditions.

Daily bonus snapshots close at 00:00 UTC. Creators rank by finalized settled fees, direct referrers by referred creators' finalized settled fees, and traders by finalized buy/sell SOL volume. The 4% of gross collected creator fees is divided into three equal category budgets. Each category pays its top three 50% / 30% / 20% of that category's budget. New fee eligibility uses the settlement finalization window; late settlements enter a later window and paid rankings remain frozen. Ties use wallet address order; unfilled ranks retain their share. The worker checks every five minutes. Winners do not claim or sign; the cutoff does not guarantee immediate payment.

Ordinary referral-network levels are separate from the Daily referrer bonus. Missing upline allocations stay in the community reserve and do not enlarge the Daily bonus pool.

For selected disposable Devnet mints, an explicit five-minute QA bonus schedule uses independent `qa5m:` snapshot keys and a 30-second worker check. Existing daily snapshots remain intact and a collection cannot fund both schedules. The UI displays the active schedule. See [QA setup and restoration](docs/daily-bonus-policy.md#five-minute-devnet-qa); the normal daily policy remains 24 hours.

Community token airdrops normally use verified migration eligibility and a 90-day claim window. A clearly labeled Devnet QA cutoff is not proof of a genuine migration snapshot.

The normal aggregate buyback trigger is 5 SOL. Selected Devnet QA settings can lower that trigger without changing the saved fee split. Quotes, liquidity, spend controls, current program approval and finalized purchase/burn proofs remain required. The app buys and burns $FUNDED, not each launched coin.

## Pages and evidence

- **Home:** verified launches, discovery, animated Daily bonus allocations, UTC countdown, buyback progress and platform metrics.
- **Explore:** search, time windows, filters, sorts, grid/table views; Favorites shows starred tokens and Following uses tracked trader wallets.
- **Coin pages:** mint, trading stage, saved V3 policy, trades, fee collections, allocations, holders and transaction actions.
- **Portfolio and wallet profiles:** created coins, holdings and available wallet activity, claims, rewards, airdrops and bonuses.
- **Capital flow:** current policy calculator and completed-day snapshot rankings.
- **Daily bonuses:** category-filtered finalized history and all-time top recipients across all recorded snapshots.
- **Rewards / History / Analytics:** verified SOL payments, net recipient amounts, fee/rent details and explicit partial coverage.
- **Airdrops:** launched-token custody, eligibility, claim proof and finalized claimed amounts.
- **Admin:** allowlisted Devnet sign-in, versioned protocol fee policy, wallet/vault inventory, audited source-signed withdrawals and guarded Daily bonus recovery.

Launch promotion tiers, paid listings and directory SOL boosts have separate receipts. Launch tiers burn the displayed $FUNDED amount; paid listings have their own burn quote; an enabled SOL boost uses an exact payment and unique quote memo before sponsored placement activates.

An allocation, funded vault, submitted signature, healthy HTTP response or similar-looking page is not a finalized payment. Tests using mocked receipts are labeled accordingly. Verify the exact source revision, Devnet genesis, configured program and expected finalized account/balance changes.

## Current guidance

The in-app Docs page and Help panel cover all product actions. Maintained references:

- [Collection, settlement, funding and payout](docs/creator-fee-collector.md)
- [Protocol percentages and saved policy](docs/protocol-fee-split-config.md)
- [Automatic rewards versus claims](docs/automatic-rewards.md)
- [Daily bonus rules and all-time history](docs/daily-bonus-policy.md)
- [Community token airdrops and migration evidence](docs/community-airdrop-devnet.md)
- [V3 buyback and burn](docs/buyback-devnet-executor.md)
- [Bounded Devnet QA conditions](docs/devnet-qa-minimums.md)
- [Admin tools and withdrawal limits](docs/admin-devnet.md)
- [Operational safeguards](docs/operations-runbook.md)

Dated audits and sections labeled historical describe their original revisions and programs. They are not current activation instructions. Earlier README implementation notes remain available in Git history at revision ef317ad3e6cafba5179b975182877da7dd308f82.

## Local development

Use the Node version supported by the lockfile and Dockerfile. Install dependencies and create ignored local configuration:

~~~powershell
npm.cmd ci
Copy-Item .env.example .env.local
~~~

Configure the intended Devnet program, RPC and server roles using public addresses and server-only secrets. Never put private keys, API tokens or RPC provider credentials in VITE-prefixed variables. For browser sign-in use the same-origin Vite proxy: VITE_API_BASE_URL=/ and API_PROXY_TARGET=http://127.0.0.1:8787 (or the configured API port).

~~~powershell
npm.cmd run server
~~~

In a second terminal:

~~~powershell
npm.cmd run dev
~~~

Open the Vite URL and connect a Devnet wallet when an action requires it. Program initialization, keeper signing and automatic execution require their reviewed server configuration; a frontend preview does not supply those prerequisites. Test-only automatic wallets belong in isolated local QA, not the public preview.

Production storage requires PostgreSQL and its configured secret inputs. Follow the operations runbook for migrations, backups, secret isolation and exact-image deployment. Preserve state and do not resubmit uncertain financial actions blindly.

## Validation and delivery

~~~powershell
npm.cmd run check
npm.cmd run verify:fee-policy
npm.cmd run build
node --test tests/daily-bonus*.test.mjs tests/fee-policy-copy.test.mjs
~~~

Run the affected Playwright regressions for documentation, fee policy, rewards and the changed UI. Browser fixtures and synthetic RPC tests do not prove live chain effects.

The Devnet deployment overlays pin the source SHA, image revision, program and runtime gates. Build from the reviewed committed source, deploy that exact revision, then verify public status, build settings, running source and affected live UI. An on-chain flow additionally needs finalized account and balance proof; Mainnet requires separate approval and readiness.
