# richpad.fun nonprogram release verification — 2026-11-24

Production serves commit `4d22c433486e784dac3a36580a24900902c1e2aa`. Jimmy's listing, administrator boost badge, trader ranking and sampled-trader explanation were checked on the live desktop and mobile layouts.

## Shipped fixes

- Keep a server-confirmed listing visible while public list caches catch up; refresh listing views after administrator listings as well as paid listings.
- Return the committed stacked boost total with an administrator boost receipt. Render it immediately and prevent stale index/history reads from erasing it. Regression coverage closes the popup and checks both `10x` and stacked `20x`.
- Refresh an open Mainnet trader leaderboard every 15 seconds and after a verified trade. The server's finalized-trade index still has its own indexing interval; a newly submitted transaction is not treated as a verified trade.
- Explain that observed traders and largest trade come from sampled trade rows. Distinguish indexed aggregate totals from sampled lower bounds and estimated buy/sell volume splits.
- Include the merged featured-scroller fix. Correct Mainnet smoke-test navigation fixtures and force production mode in the local review build helper.

## Deployment identity

- Image: `sha256:f054b774631a8e291e15de9026f3494f316475115dba4c75b298e91549e9ebd1`.
- Frontend source digest: `f0864d1a92d359f2f7aab50439b2930a8d0ce94971e31dab1bfc125c416413ac`.
- Public HTTPS revision, manifest, Mainnet genesis and all 25 entry HTML/JS/CSS asset hashes matched the release image.
- Only `app` and `rpc-gateway` were replaced. Database, cache and HTTPS container identities remained unchanged. Previous images and Compose files remain available for rollback.
- Mint, fee recipient and policy were preserved. Program activation and program settlement authorization remain false.

## Live observations

Token: `38M2z4UCfZEkUHFzD48vhKQhFhNyRGto8pZbLjNipump` (JIMMY).

- Jimmy appears first in Paid listings and appears in Home's featured tokens.
- The token header displays `⚡10x` on desktop and mobile.
- Both layouts display the explanation that trader counts use 300 sampled trades, not the complete 24-hour population; estimated buy/sell volumes use `≈`.
- The leaderboard contains the finalized Jimmy buy from `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC`.
- Transaction `2FAq5vMS1PtJQn93LXWL5DZAXB363WL6Tmf18S4J7K6HzRNCCxMQkPwhxijiLk1tuN5BdQM86RiDSzAhpzUNtyAw` was read at finalized commitment with no transaction error, an increased Jimmy token balance and a 1,000,000-lamport app-fee transfer. The fee-derived trade volume is 0.1 SOL at 100 bps. The recipient is `M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M`.
- Administrator listing/boost and the live buy were performed by the user. Automation verified their stored/public outcomes and did not submit another live payment or trade.

## Test scope and limitations

- Final repository suite: **82/82 passed**, including real local HTTP authentication/persistence tests, cache regressions, boost popup/header browser regression, leaderboard-controller refresh and metric coverage labels.
- Local HTTP tests use ephemeral wallets and real challenge signatures/cookies/storage. Solana mint metadata is mocked. They cover admin free listing, duplicate rejection, stacked free boosts, authorization, account favorites/CSRF/isolation, referral attribution and replay/self-referral rejection.
- Earlier release verification: Linux production integration **174/174** and security **67/67** passed. These runs preceded the final display/refresh fixes and are not represented as reruns on the final image.
- The completed broad desktop/mobile browser run covered 76 checks: 73 passed initially; two obsolete Portfolio selectors and one browser-teardown timeout passed focused reruns. It covered public routes, navigation/search/help, outage/startup recovery, favorites, referral-link persistence and unsigned trading/boost controls.
- Final empty-to-populated leaderboard refresh passed on both desktop and mobile without reloading the page. The desktop rerun passed with trace recording disabled after an earlier context-teardown timeout. Two additional search-navigation reruns completed their assertions but timed out during context teardown; they are not counted as passing test runs.
- A redundant 78-check run on the final release was stopped after additional selector/bootstrap/timing failures under concurrent browser load. Its partial output is retained; it is not a clean full-suite result. Targeted live checks of all reported fixes passed on both viewports.
- A live sell and other wallet-authorized Mainnet flows were not performed. Local fixtures and mocked UI checks are not evidence of live financial settlement. This report does not claim every possible app flow has been exhaustively tested.

## Repository cleanup

Changes were pushed to `main`. Repository inspection found no open PRs or obsolete Git branches to close/delete, and only the main worktree remained registered. Twelve stale worktree directories containing only empty directories or dependency junctions and two obsolete instruction backups were removed. Other sessions' working changes, historical evidence, secrets and production rollback material were preserved.

Machine-readable deployment and live evidence: [nonprogram-production-2026-11-24.json](evidence/nonprogram-production-2026-11-24.json). Detailed runner logs are retained locally under `tmp/release-20261124*`.
