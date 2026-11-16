import { isIP } from 'node:net';

// The visitor's address for rate limits. Behind the HTTPS proxy every socket
// comes from the proxy, so with TRUST_PROXY=true (only when the origin accepts
// traffic from Cloudflare alone) the Cloudflare visitor header is used.
// Same rule as clientKey in server/index.mjs.
export function clientAddress(req, env = process.env) {
  const remote = req?.socket?.remoteAddress || 'local';
  if (env.TRUST_PROXY === 'true') {
    const forwarded = String(req?.headers?.['cf-connecting-ip'] || '').trim();
    if (isIP(forwarded)) return forwarded;
  }
  return remote;
}
