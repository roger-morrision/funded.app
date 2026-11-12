import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

export function staticCacheControl(fileName) {
  // Only Vite's content-addressed build output may be cached across releases.
  if (/(?:^|\/)assets\//.test(fileName) && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(basename(fileName))) return 'public, max-age=31536000, immutable';
  // Fonts and artwork rarely change: a day in browsers, a week at the edge (revalidated in the background).
  if (/\.(?:woff2?|ttf|svg|png|webp|avif|jpe?g|ico)$/i.test(fileName)) return 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';
  return 'no-cache';
}

export function applyHttpPolicy(req, res) {
  const requestId = randomUUID();
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  // Private and financial API responses must not be retained by shared caches.
  res.setHeader('cache-control', edgeCacheControl(req.method, String(req.url || '').split('?')[0]));
  return requestId;
}

// Public, wallet-independent market reads may sit briefly in the CDN edge
// (Cloudflare Cache Rule) so distant visitors skip the trip to the origin.
const EDGE_CACHEABLE = [
  [/^\/api\/tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}\/(?:overview|trades)$/, 5],
  [/^\/api\/tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}\/ohlcv$/, 15],
  [/^\/api\/tokens\/market$/, 10],
  [/^\/api\/pump\/explore$/, 10],
  [/^\/api\/market\/sol-usd$/, 15],
  [/^\/api\/tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}\/holders$/, 60],
  [/^\/api\/wallets\/[1-9A-HJ-NP-Za-km-z]{32,44}\/(?:trades|holdings)$/, 30],
  // Public registry and report reads (no session or wallet input).
  [/^\/api\/(?:launches|listings|burn-receipts)$/, 10],
  [/^\/api\/home\/featured$/, 15],
  [/^\/api\/leaderboard\/traders$/, 30],
  [/^\/api\/(?:boosts|fee-policy|analytics\/summary|buyback\/status)$/, 30],
];
export function edgeCacheControl(method, pathname) {
  if (method !== 'GET' && method !== 'HEAD') return 'no-store';
  const match = EDGE_CACHEABLE.find(([pattern]) => pattern.test(pathname));
  return match ? `public, max-age=0, s-maxage=${match[1]}, stale-while-revalidate=30` : 'no-store';
}

export function publicError(error, requestId) {
  const status = Number(error?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { status, body: { error: error.message, requestId } };
  }
  return { status: 500, body: { error: 'The request could not be completed. Retry using the request ID if you contact support.', requestId } };
}

// Solana SDK and fetch adapters do not consistently set a network error code.
// Classify only recognizable transient dependency failures; keep their raw
// messages, which may contain a private RPC URL, out of public responses/logs.
export function transientDependencyCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 3; depth++, current = current.cause) {
    const code = String(current.code || '');
    if (['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(code)) return code;
    const status = Number(current.response?.status);
    if ([429,502,503,504].includes(status)) return `HTTP_${status}`;
    const message = String(current.message || '');
    if (/\b(?:HTTP|status|response)\s*429\b|\b429\s+Too Many Requests\b|\bRPC rate limit(?:ed| exceeded)?\b/i.test(message))
      return 'RPC_RATE_LIMIT';
  }
  return null;
}

export function invalidRequest(message) { return Object.assign(new Error(message), { statusCode: 400 }); }

// Use only around synchronous input validators, never around dependency calls.
export function validateInput(validate) {
  try { return validate(); }
  catch (error) { throw invalidRequest(error.message || 'Request input is invalid.'); }
}
