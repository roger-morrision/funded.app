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
- Total trading volume remains null because the app does not have a complete historical trade index. Boost spend and fee collections must never be substituted for trade volume.

Devnet amounts have no monetary value. This report supports measuring the product; it does not establish millions of users, revenue, or trading volume. Consented event counts are subject to opt-in bias, blocked requests, bots, and multiple browser sessions.

## Storage and deployment

The additive `product_journey_events` table is created by the normal PostgreSQL schema migration. Its composite primary key deduplicates concurrent submissions atomically. It is separate from payment and reward ledgers; no transaction data is rewritten. File-store installations return an unavailable configuration instead of pretending to persist site-wide metrics.

Regression coverage includes consent and schema rejection, origin and authorization gates, bounded bodies, request limits, quote-bound payment totals, concurrent PostgreSQL inserts, cluster isolation, retention, browser opt-out, legacy local-only consent, and storage/upload failures. Test traffic uses an isolated database and browser fixtures; it is not mixed into live product counts.
