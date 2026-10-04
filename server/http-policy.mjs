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

export function invalidRequest(message) { return Object.assign(new Error(message), { statusCode: 400 }); }

// Use only around synchronous input validators, never around dependency calls.
export function validateInput(validate) {
  try { return validate(); }
  catch (error) { throw invalidRequest(error.message || 'Request input is invalid.'); }
}
