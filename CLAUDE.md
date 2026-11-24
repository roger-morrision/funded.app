# richpad.fun — notes for Claude Code

Solana token discovery, trading and rewards app. **Live on Mainnet** at https://richpad.fun
in "non-program" mode (no Richpad on-chain program: launches, fee router and payouts are off;
trading, paid listings, boosts, calls, chat and referrals work). Devnet runs only locally.

## Layout
- Browser app: `index.html` → `bootstrap-entry.js` → `bootstrap.js` → `app.js` (controllers in
  `src/app/controllers`startup in `src/app/startup`features in `src/features/*`). Many legacy
  modules live at repo root. Styles: `styles/` plus root CSS files.
- Server: `server/index.mjs` (Node, routes in `server/routes`). Live data layer in `server/live`
  (snapshot cache for public reads, `/api/live` WebSocket) with browser side in `src/lib/live-*.js`
  topics are listed in `src/lib/live-topics.js`.
- On-chain reads go through separate `rpc-gateway` service (provider rotation, Redis cache).
- Market data: free sources first (DexScreener, Jupiter, GeckoTerminal), Birdeye (paid) last.

## Checks (run before committing)
- `npm run check` — syntax + size budget (max 500 lines / 40 KB per source file; split module
  rather than growing one).
- `node --test tests/*.test.mjs` — unit tests (~560).
- `npm run review:local` — Mainnet build served locally against live data + 36 smoke checks.
- `npm run test:smoke` — same smoke checks against https://richpad.fun.
- `npm run review:flows | review:consistency | review:layout | review:pages` — interactive flows,
  cross-page number consistency, layout shift, full screenshots + metrics (to `tmp/review/out`).
  They target richpad.fun; set `REVIEW_BASE_URL` (or use `node scripts/review/with-server.mjs …`)
  for local build. Prefer these text checks over screenshots.

## Deploy (only when the user says so)
- Follow `docs/mainnet-nonprogram-site-release.md`. Build the exact committed source,
  compare fresh current and candidate inventories, and review the resolved Compose diff.
- Switch only app and rpc-gateway under a release lock with `--no-deps --no-build --pull never`.
  Retain the prior image, source, Compose file, secrets, database and backups for rollback.
- Do not use the historical `tmp/mainnet-deploy/ship.sh`: it changes dependencies,
  transfers secrets and prunes release material.
- Verify health, public revision, frontend digest, cluster, mint, fee policy and disabled
  program activation, then run the relevant desktop/mobile and nonprogram flow checks.
- Server commands: `python tmp/mainnet-deploy/remote-io.py run <script.sh> [timeout]` `put <local> <remote> [mode]`
  `get <remote> <local>`. Set `MSYS_NO_PATHCONV=1` in Git Bash `/` arguments become Windows paths.

## Server (66.29.149.166, compose project `richpad-mainnet`)
- Origin accepts only Cloudflare IPs (`/opt/richpad/mainnet/Caddyfile`app trusts `cf-connecting-ip`).
- Watchdog every 5 min, emails admin address: `/opt/richpad/monitor/monitor.py` (also keeps
  Cloudflare ranges current daily). Source: `tmp/mainnet-deploy/richpad-monitor.py`.
- Nightly DB backup 02:30 UTC, 14 days: `/opt/richpad/backups/pg-backup.sh`.
- Open issue: SSH still allows root password login (deploys use password in `.secrets/.server`).

## Rules and gotchas
- Mainnet writes are allowlist (`server/network-write-policy.mjs`); don't widen it without asking.
- Never restore Devnet services on remote host; don't run local `devnet-api` preview
  while funded.vip Docker stack runs (both act as same Devnet authority).
- Other Claude sessions often work in this checkout at same time: commit only your own files,
  and never revert changes you didn't make. `.claude/launch.json` belongs to user.
- Shell heredocs containing backticks `${…}` may be blocked by safety check; use Edit
  tool for such code changes.
- Secrets live in `.secrets/` (git-ignored); never print them.

