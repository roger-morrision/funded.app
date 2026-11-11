import { isRpcQuotaRejection } from './rpc-failover.mjs';

// Round-robin over free RPC endpoints; a rate-limited or failing endpoint cools
// down while the others serve. Paid endpoints (e.g. Helius) are used only when
// every free endpoint is cooling down. Writes are never replayed after an
// ambiguous outcome; only explicit quota/rate rejections move to the next one.
// Methods free public RPCs refuse or throttle hard (indexed account scans,
// holder lists, history) and transaction sends go to the paid endpoint first;
// cheap point reads stay on free endpoints first to save paid credits.
export const PAID_FIRST_METHODS = new Set(['getTokenAccountsByOwner', 'getTokenLargestAccounts', 'getProgramAccounts',
  'getSignaturesForAddress', 'getTransaction', 'getTokenAccountsByDelegate', 'sendTransaction', 'simulateTransaction',
  'getPriorityFeeEstimate', 'getAsset', 'getAssetsByOwner', 'searchAssets', 'getTokenAccounts']);
export function createRotatingRpcTransport({ free = [], paid = [], now = Date.now, cooldownMs = 30_000, quotaCooldownMs = 3_600_000, paidFirst = PAID_FIRST_METHODS } = {}) {
  const pool = [...free.map(t => ({ ...t, tier: 'free' })), ...paid.map(t => ({ ...t, tier: 'paid' }))]
    .map(entry => ({ ...entry, coolUntil: 0, requests: 0, failures: 0 }));
  if (!pool.length) throw Error('At least one RPC endpoint is required.');
  let cursor = 0;
  // Endpoints that refuse a specific method (e.g. PublicNode's "indexed requests
  // require a personal token" 403) skip only that method for an hour.
  const methodBlocked = new Map();
  const blocked = (entry, method) => (methodBlocked.get(`${entry.name}:${method}`) || 0) > now();
  function candidates(method) {
    const t = now(), order = [];
    const freeReady = pool.filter(entry => entry.tier === 'free' && entry.coolUntil <= t && !blocked(entry, method));
    for (let i = 0; i < freeReady.length; i++) order.push(freeReady[(cursor + i) % freeReady.length]);
    cursor = (cursor + 1) % Math.max(1, freeReady.length);
    const paidReady = pool.filter(entry => entry.tier === 'paid' && entry.coolUntil <= t && !blocked(entry, method));
    if (paidFirst.has(method)) order.unshift(...paidReady); else order.push(...paidReady);
    if (!order.length) order.push([...pool].sort((a, b) => a.coolUntil - b.coolUntil)[0]);
    return order;
  }
  const transport = async payload => {
    const readonly = /^get[A-Z][A-Za-z0-9]*$/.test(payload.method) || payload.method === 'isBlockhashValid';
    let last = { status: 503, headers: {}, body: null };
    for (const entry of candidates(payload.method)) {
      entry.requests++;
      let response;
      try { response = await entry.transport(payload); }
      catch (error) {
        entry.failures++; entry.coolUntil = now() + cooldownMs;
        if (!readonly) throw error;
        continue;
      }
      const quota = isRpcQuotaRejection(response);
      const outage = readonly && [500, 502, 503, 504].includes(response.status) && !(response.body && typeof response.body === 'object' && Object.hasOwn(response.body, 'result'));
      const unsupported = readonly && response.body?.error && [-32601, 35, -32052].includes(response.body.error.code);
      const refused = readonly && !quota && (response.status === 403 || /personal token|not (?:supported|available)|disabled/i.test(String(response.body?.error?.message || '')));
      if (refused) { methodBlocked.set(`${entry.name}:${payload.method}`, now() + 3_600_000); last = response; continue; }
      if (!quota && !outage && !unsupported) return response;
      entry.failures++;
      entry.coolUntil = now() + (quota && /usage|credit|quota/i.test(JSON.stringify(response.body || '')) ? quotaCooldownMs : cooldownMs);
      last = response;
      if (!readonly && !quota) return response;
    }
    return last;
  };
  transport.stats = () => ({ rotating: true, endpoints: pool.map(entry => ({ name: entry.name, tier: entry.tier, requests: entry.requests,
    failures: entry.failures, coolingForMs: Math.max(0, entry.coolUntil - now()) })) });
  transport.close = () => pool.forEach(entry => entry.transport.close?.());
  return transport;
}
