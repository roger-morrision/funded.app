# Birdeye market fallback

The server uses Birdeye Token Overview when the primary Mainnet RPC market scan fails or returns unavailable coverage. Token pages show indexed price, market cap, 24-hour USD volume, holder count and trade counts with Birdeye attribution. A successful primary scan remains preferred. Indexed summaries never enter confirmed trade-event storage or Top 100 growth snapshots and cannot authorize trades, payouts, burns or holder eligibility.

Configure `BIRDEYE_API_KEY_FILE` as a server-only secret-file path. Mount the file read-only in the API container. The optional `compose.birdeye.yml` overlay takes its host path from `FUNDED_BIRDEYE_API_KEY_FILE`. Do not put the key in `VITE_*`, tracked files or Docker build arguments. The existing Birdeye discovery endpoint uses the same credential. Requests are restricted to the official HTTPS origin, reject redirects, and suppress upstream error bodies.

Summaries expire after 60 seconds; failed reads are cached for 10 seconds. Duplicate mint requests share one operation. Provider requests are spaced by at least 1.1 seconds; excess requests fail without queuing. HTTP failures trigger 30 seconds of cooldown, or five minutes for authentication/access failures. Missing fields remain unavailable rather than becoming zero. USD volume is never relabeled as SOL volume.

Birdeye is not a Solana JSON-RPC replacement. Devnet token data never falls back to Mainnet indexed data; the existing public Devnet RPC failover remains in use. Wallet balances, transaction history/proofs, signing and submission still require a working RPC. This change does not activate Mainnet financial flows.

API references: [Token Overview](https://docs.birdeye.so/reference/get-defi-token_overview), [Price](https://docs.birdeye.so/reference/get-defi-price).

Validation: the supplied credential returned successful live SOL Price and Token Overview responses. Automated fixtures cover primary failure/recovery, cache expiry, network isolation, absent fields, credential destination, cooldown and display-only rendering. These fixtures do not establish live Mainnet trading readiness.
