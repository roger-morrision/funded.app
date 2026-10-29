import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

export function staticCacheControl(fileName) {
  // Only Vite's content-addressed build output may be cached across releases.
  return /(?:^|\/)assets\//.test(fileName) && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(basename(fileName))
    ? 'public, max-age=31536000, immutable' : 'no-cache';
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
  res.setHeader('cache-control', 'no-store');
  return requestId;
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
