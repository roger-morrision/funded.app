# Launch tier X marketing

Every new registered project uses the platform X outbox after its Pump creation is verified on Solana Devnet at finalized commitment. Paid tiers also require a matching atomic $FUNDED burn.

| Tier | funded.vip X package |
| --- | --- |
| Standard | One basic launch announcement |
| Pro | One featured launch post with its verified Pro tier |
| Premier | One featured launch post, then one separate follow-up no earlier than 24 hours after the launch transaction |

The follow-up waits until the first launch post has durable `posted` status. Each post has its own deterministic event ID and is never retried after an uncertain delivery outcome. The collector rechecks finalized creation for every tier and the matching BurnChecked instruction for paid tiers before enqueueing a post. Devnet copy is labeled as a test. `X_POST_START_AT` is the activation boundary: launches whose finalized transaction predates it are not backfilled.

## Activation

The target supplied by the owner is [@fundedvip](https://x.com/fundedvip). A dedicated OAuth 1.0a API key/secret and user access token/secret are kept in ignored local secret files. The worker reads `X_POST_API_KEY_FILE`, `X_POST_API_SECRET_FILE`, `X_POST_ACCESS_TOKEN_FILE`, and `X_POST_ACCESS_TOKEN_SECRET_FILE`; the app-only `X_BEARER_TOKEN` is only for account lookup and cannot serve as the publisher credential. Run `node --env-file=.env.x scripts/verify-x-post-account.mjs` to check that the user credential belongs to @fundedvip before enabling posts.

The worker remains in draft mode until the account check succeeds and publication is explicitly started. Set `X_POST_EXPECTED_HANDLE=fundedvip`, `X_POST_PUBLIC_ORIGIN=https://funded.vip`, `X_POST_START_AT` to the activation timestamp, `X_POST_ENABLED=true`, `X_POST_ALLOW_DEVNET=true`, and a durable `DATABASE_URL`. Then run `node scripts/run-x-post-worker.mjs --loop --execute` under a supervised process, with the four OAuth 1.0a secrets mounted. Use `node scripts/run-x-post-worker.mjs --status` to inspect the outbox. Do not put credentials in the repository or reuse creator X sign-in credentials.

The account write credentials are configured in the local workspace, but publication stays disabled until the account and provider access are verified. Package copy discloses that posting occurs only while the platform publisher is active. A local build or synthetic test does not prove an X post was published.
