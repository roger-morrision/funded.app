

// Created once by the server composition layer; state belongs to this instance.
export function createSolanaRpcProxy({
  store,
  solanaRpcUrl,
  body,
  authorized,
  clientKey,
  json,
  rpcMethods,
  fetch = (...args) => globalThis.fetch(...args),
}) {
  const rpcCache = new Map();
  let rpcInflight = 0;

  async function proxySolanaRpc(req, res) {
    const origin = String(req.headers.origin || '');
    if (origin) {
      let allowed = false;
      try { allowed = ['localhost', '127.0.0.1'].includes(new URL(origin).hostname) || origin === process.env.CORS_ORIGIN; } catch {}
      if (!allowed) return json(res, 403, { error: 'RPC origin is not allowed.' });
    }
    const request = await body(req);
    if (!request || request.jsonrpc !== '2.0' || !rpcMethods.has(request.method) || !Array.isArray(request.params)) return json(res, 400, { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Unsupported Solana RPC request.' } });
    if (request.method === 'getProgramAccounts' && !authorized(req)) return json(res, 401, { error: 'Privileged Solana RPC authorization is required.' });
    const now = Date.now();
    if (['sendTransaction', 'simulateTransaction'].includes(request.method) && (typeof request.params[0] !== 'string' || request.params[0].length > 3_000)) return json(res, 400, { error: 'Invalid serialized transaction.' });
    if (request.method === 'getSignaturesForAddress') {
      const options = request.params.length === 1 ? {} : request.params[1];
      if (request.params.length < 1 || request.params.length > 2 || !options || typeof options !== 'object' || Array.isArray(options)) {
        return json(res, 400, { error: 'Signature lookup requires an address and an optional configuration object.' });
      }
      const { limit: requestedLimit, ...config } = options;
      const limit = Object.hasOwn(options, 'limit') ? requestedLimit : 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json(res, 400, { error: 'Signature lookup limit must be an integer from 1 to 100.' });
      // Solana defaults to 1,000 if omitted. Normalize before cache keys and
      // forwarding so omitted and explicit capped limits use the same request.
      request.params = [request.params[0], { ...config, limit }];
    }
    const cacheable = !['sendTransaction', 'simulateTransaction', 'requestAirdrop'].includes(request.method);
    const cacheKey = cacheable ? JSON.stringify([request.method, request.params]) : null;
    const cached = cacheKey && rpcCache.get(cacheKey);
    const client = clientKey(req);
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const cost = cached?.expiresAt > now ? 1 : ({ getProgramAccounts: 20, sendTransaction: 10, simulateTransaction: 8, getTransaction: 3, getSignaturesForAddress: 3, requestAirdrop: 20 }[request.method] || 1);
    // Keep a small, bounded read budget for an explicit user quote preview so
    // background discovery cannot starve its on-chain account checks.
    const previewRead = new URL(req.url, 'http://localhost').searchParams.get('purpose') === 'trade-preview'
      && ['getAccountInfo', 'getMultipleAccounts', 'getBalance', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getMinimumBalanceForRentExemption'].includes(request.method);
    const rateKey = previewRead ? `rpc-preview:${client}` : `rpc:${client}`;
    const rateLimit = previewRead ? 40 : 120;
    if (!await store.chargeRpcRate(rateKey, cost, rateLimit, windowStart)
      || (['sendTransaction', 'requestAirdrop'].includes(request.method) && !await store.chargeRpcRate(`rpc-write:${client}`, 1, 10, windowStart))) return json(res, 429, { jsonrpc: '2.0', id: request.id, error: { code: 429, message: 'Solana RPC limit reached; retry shortly.' } });
    if (cached?.expiresAt > now) return json(res, 200, { ...cached.data, id: request.id });
    if (rpcInflight >= 12) return json(res, 429, { jsonrpc: '2.0', id: request.id, error: { code: 429, message: 'Solana RPC is busy; retry shortly.' } });
    rpcInflight += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const upstream = await fetch(solanaRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      const result = await upstream.json().catch(() => null);
      if (!result || typeof result !== 'object') return json(res, 502, { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Solana RPC returned an invalid response.' } });
      if (cacheKey && upstream.ok && !result.error) {
        if (rpcCache.size > 500) rpcCache.clear();
        rpcCache.set(cacheKey, { data: result, expiresAt: Date.now() + (request.method === 'getTransaction' ? 30_000 : request.method === 'getLatestBlockhash' ? 1_000 : 5_000) });
      }
      return json(res, upstream.status, result);
    } catch { return json(res, 502, { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Solana RPC is unavailable.' } }); }
    finally { clearTimeout(timeout); rpcInflight -= 1; }
  }

  return { proxySolanaRpc };
}
