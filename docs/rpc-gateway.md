# Shared Devnet RPC service

The app, browser RPC proxy, collector and automation workers use one private `rpc-gateway` service. Only the gateway mounts the configured Helius or public-RPC URL. Change `.secrets/rpc-gateway-upstream-url` to switch providers, then recreate the gateway. Never point that file at the gateway itself.

The gateway keeps one persistent provider HTTP socket and one serial request budget: ordinary requests start at least 500 ms apart, and historical block reads at least 2.5 seconds apart. Provider rate limits trigger a shared cooldown. An explicitly method-specific limit cools down only that method, so unrelated financial reads can continue. Health and metrics requests use local state and consume no provider requests.

Simultaneous identical reads share one upstream request. Compatible base64 account reads are grouped into one atomic `getMultipleAccounts` request, with the same commitment, encoding, data slice and minimum context slot. Each caller receives its original account and response ID. Batches are capped at the [Solana limit of 100 accounts](https://solana.com/docs/rpc/http/getmultipleaccounts).

Only network identity and non-null finalized transaction/block history are cached. Mutable balances, blockhashes, holder indexes and signature statuses are never served from a TTL cache. A transaction submission separates later readers from earlier in-flight reads. Submissions and simulations are never cached, deduplicated, automatically retried or replayed to another provider. Existing application receipt/reconciliation guards remain active.

Browser signature subscriptions pass through `/api/solana/ws`. Internal SDKs use the private WebSocket port 8900. The gateway polls unique signatures together over its existing HTTP transport; it does not open a provider WebSocket. Only transaction-signature subscriptions are supported. Origin checks, bounded subscriptions and the existing public HTTP rate limits remain in place.

Use `compose.rpc-gateway.yml` after the normal app/collector/agency overlays, or run `node scripts/stage-rpc-gateway.mjs --revision=<tested-sha>` against the existing deployment. The staging helper preserves financial policies and removes provider secret mounts from the clients. Start the gateway first, confirm Devnet and the pinned program hash through it, then switch the app and workers. `scripts/stage-automation-services.mjs` preserves central routing on later releases.

Local tools can use `http://127.0.0.1:8899` and `ws://127.0.0.1:8900`; both host ports bind only to loopback. Provider credentials remain inside the gateway. Metrics at `/metrics` expose request, upstream, cache, coalescing, atomic-batch, queue and cooldown counts without addresses, signed transactions or credentials. Request-count savings do not by themselves measure a provider's billed credits.

Live deployment and measured verification are recorded below after activation.
