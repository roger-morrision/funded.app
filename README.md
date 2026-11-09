# richpad.fun

Platform token: **$RICH**. See the [brand and domain migration notes](docs/richpad-brand-migration.md) for deployment configuration and compatibility details.

A Solana Devnet application for launching and discovering tokens, inspecting V3 creator-fee routes, and tracking verified rewards. Mainnet activation is a separate reviewed release.

## Local Docker resource limits

The app Compose files cap the eight-service stack at 2.6 CPU cores and 2,112 MiB RAM in total, with container swap disabled. These are ceilings, not reserved resources. Limits leave headroom above the observed idle usage; sustained-load behavior has not been verified at these limits.

| Service | CPU cores | RAM ceiling |
| --- | ---: | ---: |
| App | 0.75 | 512 MiB |
| PostgreSQL | 0.50 | 384 MiB |
| RPC gateway | 0.50 | 256 MiB |
| Agency buyback worker | 0.25 | 256 MiB |
| Fee collector | 0.20 | 192 MiB |
| Buyback worker | 0.15 | 128 MiB |
| Redis | 0.15 | 256 MiB |
| Tunnel | 0.10 | 128 MiB |

Existing containers also have these limits applied with `docker update`. Recreating containers from an older frozen release can restore its original settings: append `-f compose.resources.yml` last to that release's Compose command for the full eight-service stack. Do not edit immutable release artifacts. Check `docker compose ... config --quiet` before recreating services.

For future standalone Rust build containers, include `--cpus 1 --memory 3g --memory-swap 3g -e CARGO_BUILD_JOBS=1` in `docker run`. Builds will take longer and may need a larger memory ceiling if compilation runs out of memory. Runtime service limits do not limit separate image builds.

Stop containers when unused, then run `docker desktop stop` to release Docker Desktop's VM resources. Starting Docker Desktop alone does not deliberately resume manually stopped services; start the desired services explicitly when needed.

## Approved referral update

The approved new referral policy totals **1% of gross collected creator fees**:
**L1 0.6% · L2 0.25% · L3 0.15%**. The separate AI agency allocation is 2%. The verified policy published by
`/api/fee-policy` governs new launches; the older fallback is identified separately.
Policy publication and executor readiness are independent. Existing coins and
recorded payments retain their saved rates.

## Published new-launch fee allocation

The current new-launch default, as a percentage of **gross creator fees collected**, is:

| Destination | Gross share | Meaning |
| --- | ---: | --- |
| Creator-directed | 80% | Saved split between the creator wallet, coin holders and a named X account |
| Operations & marketing | 8% | The app allocation for platform operations and marketing |
| Referral network | 1% | Levels 1/2/3: 0.6% / 0.25% / 0.15% of gross |
| Daily bonus | 4% | Equal creator, direct-referrer and trader category pools |
| $RICH buyback | 5% | Dedicated V3 vault allocations for protected purchase and burn |
| AI marketing & coin buybacks | 2% | Both buyback agents are included; promotion packages add X promotion. Execution requires verified funding and readiness |

These are percentages of creator fees, not trade volume or every Pump fee. Only **8%** is the app allocation for Operations & marketing; **92%** is allocated to creators and ecosystem benefits. The published `/api/fee-policy` and verified on-chain configuration govern new launches. [config/marketing-agency.js](config/marketing-agency.js) contains the current defaults; [config/protocol-fee-split.js](config/protocol-fee-split.js) is the historical fallback, not the current agency policy. Existing coins and settlements retain their recorded on-chain category units. Collection, settlement, source funding and finalized recipient payment are separate stages. Active automatic routes settle and disburse the saved policy without repeated creator signatures; manual routes can require creator approval.

## Automatic rewards and claims

| Program | Asset | Recipient action |
| --- | --- | --- |
| Creator wallet | SOL | Automatic on an active funded automatic route; review/sign available manual actions |
| Coin holders | SOL | Automatic after complete eligibility, funding and minimum checks |
| X account | SOL | Named account signs in, links its recipient wallet and claims |
| Referral network | SOL | No recipient claim; automatic or creator-approved transfers pay the frozen upline |
| Daily bonus | SOL | Automatic after completed-day snapshot and exact source funding |
| Community airdrop | Launched coin tokens | Eligible wallet checks its proof and claims within the displayed window |

Standard holder rewards use hourly periods and five-minute finalized samples. Selected Devnet QA coins can use five-minute periods and reduced minima. Check each coin's actual program conditions.

Daily bonus snapshots close at 00:00 UTC. Creators rank by finalized settled fees, direct referrers by referred creators' finalized settled fees, and traders by finalized buy/sell SOL volume. The 4% of gross collected creator fees is divided into three equal category budgets. Each category pays its top three 50% / 30% / 20% of that category's budget. New fee eligibility uses the settlement finalization window; late settlements enter a later window and paid rankings remain frozen. Ties use wallet address order; unfilled ranks retain their share. The worker checks every five minutes. Winners do not claim or sign; the cutoff does not guarantee immediate payment.

Ordinary referral-network levels are separate from the Daily referrer bonus. Missing upline allocations stay in the community reserve and do not enlarge the Daily bonus pool.

For selected disposable Devnet mints, an explicit five-minute QA bonus schedule uses independent `qa5m:` snapshot keys and a 30-second worker check. Existing daily snapshots remain intact and a collection cannot fund both schedules. The UI displays the active schedule. See [QA setup and restoration](docs/daily-bonus-policy.md#five-minute-devnet-qa); the normal daily policy remains 24 hours.

Community token airdrops normally use verified migration eligibility and a 90-day claim window. A clearly labeled Devnet QA cutoff is not proof of a genuine migration snapshot.

The normal aggregate buyback trigger is 5 SOL. Selected Devnet QA settings can lower that trigger without changing the saved fee split. Quotes, liquidity, spend controls, current program approval and finalized purchase/burn proofs remain required. This program buys and burns $RICH. The separate AI agency agents buy and burn the launched coin using its saved agency budget and milestones.

## Pages and evidence

- **Home:** verified launches, discovery, animated Daily bonus allocations, UTC countdown, buyback progress and platform metrics.
- **Explore:** search, time windows, filters, sorts, grid/table views; Favorites shows starred tokens and Following uses tracked trader wallets.
- **Coin pages:** mint, trading stage, saved V3 policy, trades, fee collections, allocations, holders and transaction actions.
- **Portfolio and wallet profiles:** created coins, holdings and available wallet activity, claims, rewards, airdrops and bonuses.
- **Capital flow:** current policy calculator and completed-day snapshot rankings.
- **Daily bonuses:** category-filtered finalized history and all-time top recipients across all recorded snapshots.
- **Rewards / History / Analytics:** verified SOL payments, net recipient amounts, fee/rent details and explicit partial coverage.
- **Airdrops:** launched-token custody, eligibility, claim proof and finalized claimed amounts.
- **Callouts:** token-chat calls, sampled market-cap rankings and caller profiles; observed peaks are not realized returns.
- **AI Marketing:** saved agent selection, budgets, milestones, publisher readiness and execution receipts.
- **Profile:** local notices and trade preferences, reviewed follows/reminders backup, optional X sync and reviewed guest issue reports.
- **Community pilot:** a local communication plan; it does not post, trade or allocate incentives.
- **Admin:** allowlisted Devnet sign-in, versioned protocol fee policy, wallet/vault inventory, audited source-signed withdrawals and guarded Daily bonus recovery.

Launch promotion tiers, paid listings and directory SOL boosts have separate receipts. Launch tiers burn the displayed $RICH amount; paid listings have their own burn quote; an enabled SOL boost uses an exact payment and unique quote memo before sponsored placement activates.

An allocation, funded vault, submitted signature, healthy HTTP response or similar-looking page is not a finalized payment. Tests using mocked receipts are labeled accordingly. Verify the exact source revision, Devnet genesis, configured program and expected finalized account/balance changes.

## Current guidance

The in-app Docs, Questions/FAQ and Help center share page guidance. Help opens the relevant explanation for the current page. Start with the [all-page product guide](docs/product-guide.md) and [documentation index](docs/README.md). These describe the current source; runtime gates and finalized receipts determine availability and execution. Maintained references:

- [Collection, settlement, funding and payout](docs/creator-fee-collector.md)
- [Protocol percentages and saved policy](docs/protocol-fee-split-config.md)
- [Automatic rewards versus claims](docs/automatic-rewards.md)
- [Daily bonus rules and all-time history](docs/daily-bonus-policy.md)
- [Community token airdrops and migration evidence](docs/community-airdrop-devnet.md)
- [V3 buyback and burn](docs/buyback-devnet-executor.md)
- [Bounded Devnet QA conditions](docs/devnet-qa-minimums.md)
- [Admin tools and withdrawal limits](docs/admin-devnet.md)
- [Operational safeguards](docs/operations-runbook.md)

Retired release, audit and planning reports are preserved in Git history and local recovery archives. They are not current activation instructions. Earlier README implementation notes remain available in Git history at revision ef317ad3e6cafba5179b975182877da7dd308f82.

## Launch protections and service prices

New launches protect a ticker on richpad.fun for 12 hours and escrow the declared initial developer token purchase for a selected **6h, 12h, 24h or 48h** period (**12h default**), capped at 20% of supply. Choose the period beside Developer buy before signing; the deadline is fixed at launch. Existing locks keep their saved deadlines. Zero developer purchases need no escrow; later purchases and other wallets are outside this lock. Developer token locks do not delay creator SOL earnings. See [scope and release](docs/launch-protections.md).

Code defaults are 1% app trading on buys and sells, 0.02 SOL per launch, $150 Pro, $300 Premier and $300 external listing in quoted $RICH burns. These are defaults, not locked live quotes. The service-price endpoint and reviewed quote govern; network, rent, Pump/pool costs and purchases are separate. See [service fees](docs/app-service-fees.md).

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
npm.cmd run build
~~~

The previous test suites have been removed. Add tests only for new features as they are introduced. Syntax, source-size and build checks remain available through the commands above.

The Devnet deployment overlays pin the source SHA, image revision, program and runtime gates. Build from the reviewed committed source, deploy that exact revision, then verify public status, build settings, running source and affected live UI. An on-chain flow additionally needs finalized account and balance proof; Mainnet requires separate approval and readiness.
