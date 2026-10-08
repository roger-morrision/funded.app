# Product measurement

## Visitor choice

Open **Following → Following preferences → Privacy controls**. “Share anonymous app usage” is a separate, default-off setting. Existing device-only consent never enables uploads. There is no replay of earlier device counters.

Only consent, an allowed event name, and a random browser-tab session code are sent to the app origin. Requests omit cookies and referrers. No wallet, X identity, URL, text, token address, transaction signature, or amount is included. The browser rotates its session code daily. The server stores only its day- and network-specific hash, date, and event name. Normal API abuse prevention remains active independently of these metrics.

Opting out stops later sends, cancels in-flight fetches where possible, and removes this tab's session code. A request already received cannot be retracted. Previously shared counts expire from the report after 30 UTC calendar days. Indexed cleanup runs on writes, reads, and hourly while the app is running. A remote opt-in never silently reverses this tab's opt-out. Storage or upload failure stops sharing in the tab.

## Operator report

`GET /api/product-metrics` requires the existing operator bearer token. Reports are not public and carry `Cache-Control: no-store`.

From an authorized operator environment:

```powershell
node scripts/product-metrics-report.mjs https://funded.vip
```

Set `FUNDED_API_TOKEN` or `FUNDED_API_TOKEN_FILE` outside source control. The script refuses redirects and insecure non-local origins. It prints JSON without the token.

- `journeys.dailyEvents`: distinct consenting browser-session-days reaching each step; repeat events in one session-day count once.
- `journeys.dailySessions`: session-days with at least one event. These are not unique people, wallets, or cross-day retention cohorts. Browser event names such as `trade_confirmed` remain self-reported signals, not transaction proof.
- `confirmed.registeredLaunches`: current verified registry count.
- `confirmed.boostPurchases` and `boostPaidLamports`: deduplicated stored finalized payments matching their original quotes, including expired packs.
- Fee collection and payout totals use the existing finalized receipt reader. Its coverage, freshness, and partial/unavailable states are retained. Unknown totals remain null.
- Total trading volume remains null until historical completeness is established. `confirmed.tradingActivity` separately reports exact finalized trade volume observed by the durable index, its time range, scan status, and freshness. Boost spend and fee collections are never substituted for trade volume.

Devnet amounts have no monetary value. This report supports measuring the product; it does not establish millions of users, revenue, or trading volume. Consented event counts are subject to opt-in bias, blocked requests, bots, and multiple browser sessions.

## Storage and deployment

The additive `product_journey_events` table is created by the normal PostgreSQL schema migration. Its composite primary key deduplicates concurrent submissions atomically. It is separate from payment and reward ledgers; no transaction data is rewritten. File-store installations return an unavailable configuration instead of pretending to persist site-wide metrics.

Regression coverage includes consent and schema rejection, origin and authorization gates, bounded bodies, request limits, quote-bound payment totals, concurrent PostgreSQL inserts, cluster isolation, retention, browser opt-out, legacy local-only consent, and storage/upload failures. Test traffic uses an isolated database and browser fixtures; it is not mixed into live product counts.

## Finalized trade history

Run `node scripts/index-product-trades.mjs 4 4` in the operator container to process up to four route pages and retry up to four older proof gaps. The optional second number can be zero to skip retries. It reads `DATABASE_URL[_FILE]` and `SOLANA_DEVNET_RPC_URL[_FILE]` (or `SOLANA_RPC_URL[_FILE]`), never wallet keys. It checks Devnet identity, uses finalized RPC reads, disables automatic rate-limit retries, and spaces requests. No trade or transfer is submitted. Exit code 2 means blockers or unresolved proofs remain; the JSON report distinguishes these from a fatal run failure (exit code 1).

The worker visits least-recently checked registered mint/route pairs first, stores a historical cursor per curve or canonical SOL pool, and checkpoints each page atomically. After reaching provider history's end it refreshes from the newest signature back to the previous head. Unavailable transactions and missing or truncated logs are recorded in `product_trade_gaps`, atomically with the verified events and page cursor. They never contribute volume, but no longer prevent adjacent verified transactions from being indexed. Transport errors, malformed invocations, and conflicting proofs still leave that page's cursor unchanged. Signature and log position deduplicate events, including overlapping scans and restarts. A database advisory lock prevents concurrent index passes.

Each run retries the oldest checked gaps within its separate budget, restricted to currently verified registered mints. A recovered proof is inserted and its gap removed in one transaction without changing the history cursor. Unresolved gaps retain the signature, slot, route, a fixed reason code, attempt count, and first/latest check times; RPC URLs and raw errors are not stored. The private aggregate report includes `unresolvedProofs` and reason counts, with status `partial-with-gaps` when scans can progress but evidence remains missing. Proof counts are per mint/route/signature; one transaction can leave more than one proof gap. A scan reaching the provider's history end does not resolve these gaps. Runtime-truncated logs may remain permanently unavailable.

Only events from successful Pump/PumpSwap invocations and successful ancestors count. Failed transactions, caught failed inner calls, mismatched signatures/slots, unsupported networks, truncated logs, and wrong pool owners do not become volume. Exact integer amounts are stored without floating-point rounding. No trader-wallet column is added.

Coverage is deliberately `observed-only`. RPC history can be pruned; unsupported event layouts and noncanonical or non-SOL pools are not covered. Tokens registered in funded.vip may be traded through other apps, so these totals are token activity, not app-originated trading volume. Pool amounts use the buyer's total quote input and seller's net quote output; curve amounts use the trade event's SOL amount. Network fees are excluded. Scan status and time range must accompany any reported figure.

The index is currently run on demand, not as a scheduled worker. Page limits bound RPC work; repeat a pass to continue history. Source references: [Solana signature pagination](https://solana.com/docs/rpc/http/getsignaturesforaddress) and [transaction retrieval](https://solana.com/docs/rpc/http/gettransaction).
