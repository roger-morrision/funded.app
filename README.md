# funded.vip

funded.vip is a Solana-only market dashboard with a browser-based Pump Devnet launch flow. There are no EVM, Base, Ethereum, or other-chain selectors or launch routes.

The interface uses a proof-first product hierarchy: the home screen states the fixed fee route before showing any growth features, the capital-flow calculator reconciles the full 100% claim, the public proof center separates ready policy logic from pending production infrastructure, and the launch preview shows an example per-claim outcome beside the wizard. Placeholder production volume, fake account identity, and synthetic system-health claims are intentionally omitted.

Trades use a configurable platform fee (50 bps / 0.50% by default) paid to `VITE_FUNDED_TRADE_FEE_OWNER` in the same Solana transaction as the Pump buy or sell. The owner wallet is public configuration; no private key is ever placed in the frontend. Trading fails closed until the owner wallet is configured.

## Local API foundation

Run `npm.cmd run server` in a second terminal to start the local persistence API. Set `VITE_API_BASE_URL=http://localhost:8787` before starting Vite. The API stores launch policies, idempotent Pump fee settlements, X-linked SOL claim obligations, and wallet-signature claim state. It intentionally stops before moving real funds until the Solana keeper is configured.

### X account sign-in

The claim page uses X OAuth 2.0 Authorization Code with PKCE only to identify the X account; it is not X Money. In the X Developer Console, open the app's User authentication settings, enable OAuth 2.0, choose a web/confidential client, and register the exact callback URL `http://127.0.0.1:8787/api/x/oauth/callback` for local development. Set `X_CLIENT_ID`, `X_CLIENT_SECRET`, and `X_CALLBACK_URL` in the server environment. The integration requests only `users.read offline.access`, keeps the secret server-side, and looks up the authenticated profile through `GET /2/users/me`.

### Desktop Docker preview for funded.vip

This is a **Devnet preview**, not a mainnet launch. Docker serves the built Vite app and Node API from one origin, with PostgreSQL on a private Docker network. Only `127.0.0.1:8788` is published on the desktop by default (`FUNDED_PREVIEW_PORT` can override it); the database has no host port. The Cloudflare Tunnel connects to `app:8787` inside Docker.

Deployment status (2026-09-19): the local app, PostgreSQL, and `funded-vip-devnet` Cloudflare Tunnel are running. GoDaddy now shows custom nameservers `bonnie.ns.cloudflare.com` and `jay.ns.cloudflare.com`, but the Cloudflare zone is still **pending** while public delegation propagates. The tunnel deliberately returns HTTP 403 to all requests. A Cloudflare Zero Trust organization, owner-email policy, and one-time-PIN identity provider exist, but Cloudflare will not create the `funded.vip` Access application until the zone becomes active. With the owner's approval, the current GoDaddy DNS records were staged in Cloudflare as DNS-only records: apex A (`160.153.0.211`), `www` CNAME, SPF TXT, DMARC TXT, two DKIM CNAMEs, `_acme-challenge` CNAME, and `_domainconnect` CNAME. No MX record was present in the registrar's 11-record listing; GoDaddy's default NS and SOA records are not copied. DNSSEC is off. This nameserver change moves DNS management to Cloudflare, but the staged A record still targets the old website, not the Docker app. After zone activation, create and verify the owner-only Access application before replacing that A record with a proxied CNAME to the tunnel and changing ingress from deny-all to `http://app:8787`. Changing DNS providers can still affect GoDaddy-managed website or email connections; verify them before and after. Never treat a healthy tunnel as proof the public domain serves this app.

```powershell
npm.cmd run deploy:init
docker compose --env-file .env.deploy -f compose.preview.yml up -d --build app
# Open http://127.0.0.1:8788/
```

`deploy:init` creates ignored `.env.deploy` with random database and API secrets. Never commit or share that file. The preview container automatically applies the PostgreSQL schema before starting. The frontend uses same-origin `/api` requests, so it does not embed a localhost API URL or a server secret. The Docker build excludes `.env.local` and forces Devnet with mainnet disabled.

To use the purchased domain without opening router ports, add `funded.vip` to a Cloudflare account and change the domain's nameservers at its registrar to the assigned Cloudflare nameservers. Create a remotely managed Cloudflare Tunnel, publish `funded.vip` to `http://app:8787`, and protect the preview with an owner-only Cloudflare Access policy. Put the tunnel token in the ignored `.env.deploy` file as `CLOUDFLARE_TUNNEL_TOKEN`, then run:

```powershell
docker compose --env-file .env.deploy -f compose.preview.yml --profile tunnel up -d tunnel
```

Do not publish the preview as a production financial service. `/api/readiness` must be reviewed and the audited mainnet router, payout rails, keeper, reward vault, X attestation, and abuse controls must be complete before enabling mainnet or unrestricted public access. A desktop host also stops serving the site whenever the PC, Docker Desktop, or tunnel is offline.

### PostgreSQL persistence

Local PostgreSQL is available through `docker-compose.postgres.yml`. The database is named `funded_app`, uses the persistent Docker volume `funded_app_pgdata`, and is wired through `DATABASE_URL`. Start it with `docker compose -f docker-compose.postgres.yml up -d`, then run `npm.cmd run db:migrate`. The migration copies an existing `app_state` JSON snapshot into keyed `state_entities` once; new writes update only changed records and the indexed coin-fee tables. Coin-fee and referral-claim reads use indexes, while `/api/launches?limit=100&offset=0` provides optional pagination. Keep a database backup before upgrading, stop the old API before migration, and restart only the new API afterward: old and new server versions must not write to the same database at once. `app_state` remains as a legacy snapshot and is no longer updated. Production requires both `DATABASE_URL` and `FUNDED_API_TOKEN`; local development may use `data/funded-store.json`. For remote PostgreSQL, set `DATABASE_SSL=true` and, if needed, `DATABASE_CA_CERT_PATH` to a trusted CA file. Certificate verification is enforced. To verify and preview an additive import of the old Devnet file's router-level collections, run `npm.cmd run db:import-legacy-collections`; add `-- --apply` to import. The importer checks confirmed on-chain router balance changes, preserves existing rows, and never assigns shared-router fees to a mint.

The keyed PostgreSQL store test uses a separate database and port so it cannot touch local development data. Start it with `docker compose -f docker-compose.postgres-test.yml up -d`, then run it with `BACKEND_DB_TEST=1 DATABASE_URL=postgresql://funded:funded-test@127.0.0.1:15432/funded_test npm.cmd run verify:postgres-store` (PowerShell: `$env:BACKEND_DB_TEST='1'; $env:DATABASE_URL='postgresql://funded:funded-test@127.0.0.1:15432/funded_test'; npm.cmd run verify:postgres-store`).

For local same-origin API access, set `VITE_API_BASE_URL` to the full Vite origin (for example `http://127.0.0.1:5173`), `VITE_USE_RPC_PROXY=true`, and `API_PROXY_TARGET=http://127.0.0.1:8787` (or the port running your API). Vite forwards `/api` to that server, including the Solana RPC proxy. Keep `API_PROXY_TARGET` server-side; do not put an RPC provider key in a `VITE_` variable.

## Devnet launch tests without Phantom

The X-linked fee-forwarding path fails closed until an isolated per-coin router, a mint-attributed on-chain fee collector, and a trusted X-attestation keeper are deployed. The legacy shared router cannot prove which coin earned its pooled fees. Launch policies are now wallet-signed and immutable in the API; arbitrary SOL obligations and keeper-wallet-funded X payouts are rejected. `npm.cmd run verify:x-fee-server` tests these trust gates against the confirmed Devnet Custom + Boost launch, without moving funds. It does not claim that an X payout occurred.

Configured test wallets in `.env.local` can sign directly: `npm.cmd run verify:launch-options-devnet -- preflight creator`, `npm.cmd run verify:launch-options-devnet -- standard referrer`, and `npm.cmd run verify:launch-options-devnet -- custom-boost creator`. The two launch modes create real Devnet coins; Custom + Boost irreversibly burns 25,000 `$FUNDED`. `recover <wallet> <limit>` reads recent on-chain launches and burn amounts without creating anything. Community and fee distribution settings are validated policy records, not funded or settled by the Pump creation transaction.

## Run locally

```bash
npm.cmd install
Copy-Item .env.example .env.local
# Set VITE_FUNDED_FEE_ROUTER_PROGRAM_ID in .env.local
npm.cmd run dev
```

Open the Vite URL, install Phantom, switch Phantom to **Devnet**, then use **Launch a strategy**.

The launch flow creates a Pump bonding-curve coin with the funded.vip router PDA passed directly as the Pump `creator`; the connected wallet is only the payer. The user therefore never receives Pump creator-fee authority and cannot later open Pump.fun to replace the recipient. After confirmation, the app reads the bonding curve back from Devnet and does not report success unless its `creator` equals the verified router and differs from the paying wallet.

The router address is not user-configurable. It is deterministically derived from `VITE_FUNDED_FEE_ROUTER_PROGRAM_ID` with the seed `funded-fee-router-v1`. Launches fail closed if the program id is missing, the PDA is not deployed, the PDA is not owned by the configured program, or its account header does not contain the `FUNDFEE1` version-1 marker and expected hash for the `100% in / 80% creator-directed / 20% funded.vip` policy.

The browser never receives or stores a private key. Phantom signs the transaction locally.

Devnet token artwork, description, roadmap, and HTTPS social links are now signed by the creator wallet and stored in PostgreSQL before the Pump transaction is submitted. Pump's token URI points to `https://metadata.funded.vip/devnet-metadata/{mint}`; images are served from the same public metadata-only hostname. The app remains owner-only behind Cloudflare Access. Images are limited to 600 KB and PNG/JPG/WEBP; a built-in icon is used when no image is chosen. Metadata for each mint is immutable after its first signed upload. This desktop-hosted PostgreSQL volume is persistent across container restarts, but is not decentralized or guaranteed to remain available if the PC, tunnel, or storage fails. Back up the volume before relying on the URL for a real launch.

The production policy layer exposes read-only readiness and analysis routes: `GET /api/readiness` reports missing deployment/configuration gates without revealing secrets, `POST /api/rewards/preview` validates supported transfer-tax rates and calculates dust-filtered pro-rata payouts, and `POST /api/anti-sniper/analyze` flags creator early buys, funding clusters, same-slot bursts, and rapid round trips. These routes do not move funds or replace audited on-chain programs.

The launcher is a real four-step wizard: coin identity, benefits, review, then sign and verify. Quick launch applies the recommended 3% community reserve and 80% creator-wallet destination; custom launch can divide the creator-directed 80% among the creator wallet, holder rewards, and an X-linked SOL claim. Creators can also select Standard, Boost, Pro, or Premier. Standard burns nothing. Paid tiers use configurable fixed `$FUNDED` amounts and add SPL `BurnChecked` before Pump creation in the same transaction, so the burn and coin launch succeed or fail together. A confirmed burn unlocks a verified tier badge, tier discovery filter, public receipt, featured-review eligibility at Pro, and homepage spotlight-review eligibility at Premier—never guaranteed placement. Wallet connection is deferred until review. The review screen shows the 80% creator-directed / 20% app-protocol fee split, selected tier, wallet balance, token burn, and exact network estimate, then requires explicit confirmation that the creator cannot redirect the Pump fee route. App-level referrals stay in the separate referral workspace. Dev buy and unfinished mobile signing remain hidden until their production paths exist. funded.vip does not charge a separate launch fee in this build.

Pump accrues 100% of creator fees under the funded.vip router address. The router program must claim both bonding-curve and post-graduation AMM fees using PDA signing. For every successful claim, the settlement policy creates obligations for the entire claimed amount before any settlement: 80% goes to the creator-directed wallet, holder-reward, and X-linked SOL claim destinations; 20% funds funded.vip. The app share is divided into 70% operations (14% gross), a 15% three-level referral network (3% gross), 10% community rewards (2% gross), and 5% $FUNDED buyback and burn (1% gross). The referral pool pays Level 1 10%, Level 2 3%, and Level 3 2% of funded.vip revenue, equal to 2%, 0.6%, and 0.4% of gross creator fees. Missing upline levels move to the community growth reserve. Referral registration and first-touch attribution are wallet-signed and server-owned; settlement resolves recipients from that graph, never from caller-supplied payout addresses. Referral rewards require a separate wallet signature and explicit execution request before keeper transfer. Claim transaction signatures are the idempotency key, and failed settlements remain obligations to their original recipients.

Every launch also records a community-airdrop policy. Creators reserve 3–50% of supply, $FUNDED holders are snapshotted when the coin migrates, allocations are pro-rata, and claims stay open for 90 days after a Merkle root is published. The UI includes a clearly labeled local claim preview. Production claims still require a community vault program, holder indexer, and Merkle-root publisher.

The revenue buyback policy reserves 5% of funded.vip revenue, equal to 1% of gross creator fees, when fees are actually claimed. SOL or USDC accrues in a dedicated buyback vault until the 0.25 SOL / 50 USDC threshold or six-hour maximum wait is reached. Execution rejects stale or unverified routes, slippage above 1%, price impact above 0.75%, and clips larger than 0.25% of verified pool liquidity. Purchased $FUNDED is destroyed with SPL `BurnChecked`, not transferred to a dead wallet. The app includes an idempotent local ledger and protected execution preview; production still requires an audited PDA program, verified mint, protected swap router, permissionless keeper, and receipt indexer.

Run `npm.cmd run verify:local-flow` to exercise the full prepare, wallet-sign, submit, confirmation, and status sequence with an in-memory connection and signer. This test never contacts Solana and never writes a key to disk.

Run `npm.cmd run verify:fee-policy` to verify the fixed 20% / configurable 80% allocation rules.

Run `npm.cmd run verify:fee-router` to verify deterministic PDA derivation, router-account ownership and policy-header checks, direct Pump creator assignment, separation from the paying wallet, and transaction-size safety.

Run `npm.cmd run verify:buyback-policy` to verify claim allocation, batching thresholds, execution guardrails, supply-delta receipts, and pending-vault accounting.

Run `npm.cmd run verify:launch-burn-policy` to verify the Standard, Boost, Pro, and Premier policy, fixed-mint fail-closed behavior, base-unit conversion, and atomic BurnChecked-before-Pump transaction ordering.

For the Devnet test token, run `npm.cmd run mint:funded-devnet` with the Devnet creator key in `.env.local`, then set `VITE_FUNDED_TOKEN_MINT` to the returned SPL mint address. The script creates a classic SPL mint with six decimals, mints an initial one billion tokens to the creator wallet, and revokes mint authority in the same transaction. It derives the mint address from the creator key so a retry checks the same account instead of creating another mint. Later burns reduce the live supply below one billion. To test a paid launch and verify the exact on-chain supply decrease, run `npm.cmd run verify:funded-burn-devnet -- boost` (or `pro` or `premier`). Each run creates a new Devnet Pump coin and permanently burns that tier's `$FUNDED` amount.

Run `npm.cmd run verify:proof-ui` to verify the capital-flow calculator, proof filters, honest readiness labels, and independence from third-party branding.

Run `npm.cmd run verify:airdrop-policy` to verify community reserve limits, migration snapshot policy, claim window, and pro-rata allocation math.

For a full on-chain smoke test without Phantom, `npm.cmd run verify:devnet` creates an ephemeral in-memory payer, requests one Devnet SOL, submits the mint transaction, and reads the mint and associated token account back from Devnet. The public faucet can rate-limit requests; the script reports that condition without persisting the temporary key.

## Production launch requirements

The client-side Pump launch and fee-route instructions are implemented, but production auto-distribution requires infrastructure that is not present in this frontend. Before go-live, add:

- production security review and live-wallet testing of the implemented Pump curve and canonical graduated-pool trade routes;
- an audited funded.vip fee-router program deployed at the configured program id;
- PDA-signed Pump bonding-curve and PumpSwap claim instructions;
- claim, settlement, retry, and reconciliation workers;
- recipient vaults or settlement rails for creator, holder, X-linked SOL claim, referral, community, operations, and buyback obligations;
- an X-handle attestation service, wallet-signature SOL claim flow, and PDA-signed keeper that releases verified claim obligations;
- a public claim and payout receipt indexer;
- on-chain metadata creation and a production metadata/image storage service;
- migrate Devnet metadata and images from desktop PostgreSQL to redundant, durable public storage before mainnet use;
- server-side indexing and persistence for launched tokens;
- an audited community vault and Merkle-claim program;
- a migration snapshot indexer and root-publishing service;
- edge WAF, provider quotas, and distributed abuse monitoring beyond the API's bounded RPC relay;
- abuse, compliance, and transaction simulation safeguards;
- mainnet wallet/network gating and an explicit production deployment review.

## Settlement and Devnet testing

The local API exposes `/api/indexer/status` and `POST /api/indexer/sync` for Pump launch indexing. The keeper exposes `/api/keeper/status` and `POST /api/keeper/collect`; protected writes require `FUNDED_API_TOKEN` and fail closed when it is absent. Settlement requests accept a collection signature only: the recorded positive mint-verified collection and the saved, verified launch policy supply the amount, creator, and shares. The keeper verifies the deployed router PDA, builds Pump SDK creator-fee collection instructions, signs with the server-side keeper, and records the confirmed collection signature. It fails closed when the router account is missing or its policy header is invalid. Referral registration and attribution use signed challenges; referral claims use `prepare -> verify -> execute`, with a 14-day expiry, idempotent keeper payout, and `MAX_REFERRAL_PAYOUT_SOL` limit. SOL claims use `prepare -> attest -> verify -> execute`; execution is idempotent and requires a server-side keeper key plus a stored payout obligation. On Devnet only, `DEVNET_TEST_MODE=true` enables the explicit `I_CONTROL_THIS_X_HANDLE` test attestation. Production X identity must be supplied by a trusted webhook using `X_ATTESTATION_SECRET`; the browser never accepts a private key or treats a self-asserted handle as production identity.

Coin detail needs both the Vite app and the local API (`npm.cmd run server`). The page reads mint, metadata, curve, and largest token accounts from the configured Devnet RPC. `/api/tokens/:mint/fee-activity` returns only mint-verified claims and allocations from the active database (or file fallback). Pump's `collectCoinCreatorFeeInstructions` collects for the shared creator account, not a requested mint; such transactions are stored as router-scoped records and are never counted as this coin's revenue. For a token whose on-chain creator is that router, the page lists positive shared-router collections separately with that limitation stated. `/api/tokens/:mint/market-activity` scans up to 50 recent Pump curve signatures for 24-hour SOL trade volume and price movement; it marks volume as partial if that scan does not cover the full period. Price movement needs a valid earlier trade baseline. Refreshes are rate-limited, coalesced per mint, capped globally, and cached in PostgreSQL for 60 seconds. The public RPC relay has weighted per-client budgets; `getProgramAccounts` is off unless `RPC_ALLOW_EXPENSIVE_METHODS=true` and remains API-token protected, while airdrops require both Devnet test mode and `RPC_ALLOW_AIRDROP=true`. Set `TRUST_PROXY=true` only when a trusted proxy overwrites `CF-Connecting-IP` and direct public API access is blocked. These endpoints do not provide a complete holder count, payout index, a tested live graduated-pool swap, or historical candles. Restart the API process after changing its source.

## Stonk-inspired discovery layer

The local API includes a proof-first discovery layer modeled on the useful parts of StonkFun without enabling unverified assets or artificial volume:

- `GET /api/quote-assets` returns only verified/configured Solana quote assets. Additional assets require `FUNDED_QUOTE_ASSETS_JSON` and are never accepted directly from the browser.
- `GET /api/terminal/signals` returns launch risk flags, graduation progress, turnover, and a deterministic signal score from indexed records.
- `GET /api/creators/:wallet` returns creator launch count, graduation rate, settled fees, and reputation score.
- `POST /api/launch-reviews` stores an immutable pre-signature review snapshot and SHA-256 review hash.
- `GET|POST /api/alerts` stores wallet-scoped graduation, risk-change, and volume-spike alerts.
- `POST /api/x-intake` queues a bounded X launch request for review; it never signs or submits a transaction.

The Explore screen shows the verified quote catalog and terminal signals. These features remain informational until production indexer, quote validation, alert delivery, and launch-admission controls are connected.

Explore also has a compact market scanner, mint search, source-aware cards, curve/graduated stage filters, watchlist, and inspect-or-trade shortcuts. Mint accounts and Pump curve stage are read from confirmed Solana RPC; Birdeye market figures are provider-indexed estimates and remain blank when unavailable. A shortcut only selects the mint—the user must preview a fresh quote before signing. Run `npm.cmd run verify:explore-discovery` for the filter and missing-data checks.
