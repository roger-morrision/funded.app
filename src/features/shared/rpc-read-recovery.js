import { SOLANA_GENESIS } from '../../../solana-network.js';

const PUBLIC_RPC = Object.freeze({
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
});
const TRANSIENT = new Set([429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

// Only the scheduler's exact read allowlist may enable retries or public fallback.
export function createRpcReadRecovery({ fetch: send = globalThis.fetch, cluster, timeoutMs = 6000 } = {}) {
  let publicVerifiedUntil = 0;
  async function attempt(input, init, readOnly) {
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal.reason);
    if (init.signal?.aborted) throw init.signal.reason;
    init.signal?.addEventListener('abort', abort, { once: true });
    const timer = readOnly ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await send(input, { ...init, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`Solana RPC is unavailable (HTTP ${response.status}). Please retry shortly.`);
        error.retryable = TRANSIENT.has(response.status);
        throw error;
      }
      try { await response.clone().json(); }
      catch {
        const error = new Error('Solana RPC returned an invalid response. Please retry shortly.');
        error.retryable = true;
        throw error;
      }
      return response;
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason;
      if (typeof error?.retryable === 'boolean') throw error;
      const unavailable = new Error('Solana RPC connection was interrupted. Please retry shortly.');
      unavailable.retryable = true;
      throw unavailable;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
  }
  return async function recover(input, init = {}, readOnly = false) {
    let lastError;
    for (let index = 0; index < (readOnly ? 2 : 1); index++) {
      try { return await attempt(input, init, readOnly); }
      catch (error) {
        if (init.signal?.aborted || !error?.retryable) throw error;
        if (!readOnly) throw new Error(`${error.message} If a transaction was signed, check its receipt before retrying.`);
        lastError = error;
      }
    }
    const endpoint = PUBLIC_RPC[cluster];
    if (!readOnly || !endpoint || String(input).split('?')[0] === endpoint) throw lastError;
    // Build a fresh request: never disclose application auth headers or cookies.
    const publicInit = { method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: init.signal };
    if (Date.now() >= publicVerifiedUntil) {
      const identity = await attempt(endpoint, { ...publicInit,
        body: JSON.stringify({ jsonrpc: '2.0', id: 'network-check', method: 'getGenesisHash', params: [] }) }, true);
      if ((await identity.json()).result !== SOLANA_GENESIS[cluster]) {
        throw new Error('Public RPC network verification failed. Please retry later.');
      }
      publicVerifiedUntil = Date.now() + 60_000;
    }
    return attempt(endpoint, { ...publicInit, body: init.body }, true);
  };
}
