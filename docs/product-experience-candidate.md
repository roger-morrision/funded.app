# Local product-experience API candidate

This candidate runs the current API and built browser against an isolated copy of recorded Devnet financial data. It does not upgrade the public app, reuse live authentication sessions, load wallet signing credentials, or start financial workers. Reports submitted here remain in the disposable local copy.

## Start and verify

Build the current Devnet browser first. In PowerShell:

```powershell
$env:VITE_DEV_MODE='false'
$env:VITE_DEV_AUTOCONNECT='false'
$env:VITE_SOLANA_CLUSTER='devnet'
$env:VITE_EXPLORE_CLUSTER='devnet'
$env:VITE_ALLOW_MAINNET='false'
$env:VITE_API_BASE_URL='/'
npm.cmd run build
node scripts/product-experience-candidate.mjs --source-container fundedapp-app-1 --official-rpc --serve
```

Open `http://127.0.0.1:8789`. Ctrl+C stops the candidate API and read-only RPC relay. Omitting `--serve` performs acceptance checks and stops automatically. Use a separate `--port` if needed; the reviewed API's port cannot be selected. The source origin defaults to `http://127.0.0.1:8788` and may be set with `--reviewed-api` to another explicit loopback origin.

The source container must advertise Devnet and match the reviewed API build. Its PostgreSQL data is read in a repeatable-read **READ ONLY** transaction; no repository migration/startup method is invoked against the source. Only financial buckets and registered Devnet launches are selected. Auth sessions, private creator profiles/preferences, support reports and worker heartbeats are omitted. Unexpected credential/key fields are removed. The reward file is read independently, so the two stores do not form an atomic joint snapshot.

Copied state, provenance and the acceptance report live under ignored `tmp/product-experience-candidate/<timestamp>-<local-build>/`. The build identifier starts with `local-product-`; it is not a clean Git release SHA or authorization to deploy publicly. The helper refuses a stale browser build, a mainnet build or a browser build with server-held testing-wallet mode enabled.

The candidate process receives an allowlist of operating-system variables and explicit local configuration. It does not inherit database credentials, `_FILE` secret settings, private keys, worker gates or `NODE_OPTIONS`. Its RPC relay permits reads only and rejects transaction broadcast and airdrops. `--official-rpc` uses the official Devnet endpoint for these reads; without it, the reviewed API's RPC proxy is used. A quota failure stops acceptance rather than being treated as successful verification.

## Acceptance evidence, 2026-10-30

- The real API dispatcher served the new operations, activity and exact-receipt endpoints over the copied data.
- Registered-launch coverage contained 37 completed buybacks, four pending operations and nine creator-wallet entries. This is a scoped recorded-data projection, not a complete chain-wide count or proof of current balances.
- A guest report was accepted by actual HTTP POST, denied without its private view token, returned to its owner and retained across a complete API process restart. Admin inventory rejected an unauthenticated request. Creator brief and account-sync writes rejected a missing verified session. These were local probes, not real user reports or verified-X publishing tests.
- Historical receipt `4Gm1HBt4X1fp5fNV8YnvC96vc1gM6pciMiUiy8joXN52pBRQPEPLq4rrYVEfdSLnZXeW8Gco7a93gg4AcGbUP1Zm` was independently rechecked against official Devnet RPC at finalized slot **516699579**. Existing proof code verified the program bytecode, router/receipt accounts, PumpSwap and burn instructions, **21,681 lamports** of vault debit and **2,785 $FUNDED base units** burned. Approved program-data SHA-256: `8e954319c48640654a5f703717ae37d5a950f54f5fd6b81ce57647d89cd297c5`. This is a fresh read of an existing transaction; no new transaction was signed or submitted.
- Three browser tests passed against the actual built candidate with no mocked API responses: build identity/coverage, exact historical receipt display and guest-report submit/reload/status. One separate mocked browser regression verifies that `onchain-policy` burn rows retain their working Explorer link. Six new isolation/snapshot/RPC tests passed; the final combined affected unit run passed 64 tests. Build, changed-file syntax, source size and whitespace checks passed.
- The reviewed public API retained build `bbc999712933ae8ad6256e4fc63eb50c7c68d617`. The candidate did not restart public containers, write the source database, submit a payment or change financial policy.

The reviewed proxy returned HTTP 429 during the initial RPC check. The successful independent check used `--official-rpc`, with six read requests. No faucet or retry loop was used.

## Browser acceptance

With the candidate running, set `PRODUCT_CANDIDATE_REPORT` to its printed `report.json` path and run `tests/browser/product-candidate-runtime.spec.js` through Playwright. Those tests require a loopback candidate report and never fall back to the public service. Without the environment variable they skip explicitly. The report stores no issue access token.

On-chain-policy burns without registry/collection context retain direct Explorer verification. Their recorded proofs do not become registered-launch receipts just because a signature exists. The engine-health coverage text now states this distinction.

Genuine verified-X publishing, public deployment and new financial mechanisms are outside this local acceptance result. Existing fee splits, bonus windows and custody rules are unchanged.

## Large-ledger acceptance

The live deployment has substantially larger reward-index buckets than this filtered candidate copy. Public activity reads no reward ledger; operations cache and share in-flight reads before accessing either store. Financial, health, automation and bonus status reads omit unrelated indexing buckets from the returned clone. They check the current file identity, size and nanosecond modification/change timestamps before reusing a parsed view, with no TTL. Transaction reads, locking, persistence and worker writes remain independent and unchanged. Test an exact image with representative ledger size and simultaneous dashboard/health requests as well as this filtered candidate before public rollout.
