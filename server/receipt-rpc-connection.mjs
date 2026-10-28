import { Connection } from '@solana/web3.js';

// Receipt readers must finish failed RPC reads rather than retrying a 429 for
// 7.5 seconds behind Analytics' six-second response deadline. A failed or timed
// out read remains unavailable; it never establishes payment evidence.
export function createReceiptRpcConnection(url, commitment = 'finalized', fetchImpl = fetch) {
  return new Connection(url, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: (target, options) => fetchImpl(target, {
      ...options,
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(5_000)])
        : AbortSignal.timeout(5_000),
    }),
  });
}
