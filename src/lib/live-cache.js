import { GLOBAL_TOPICS } from './live-topics.js';

// Browser side of the live data layer.
// 1. One startup request (/api/live/boot) brings the shared public reads that
//    pages otherwise fetch one by one (~25 requests, several taking ~1s each).
// 2. Snapshots pushed over /api/live (see live-socket.js) keep them current.
// 3. A thin fetch layer answers GETs for those exact paths from this cache, so
//    existing page code gets data without a network round trip. Reads made
//    before the boot response arrives wait for it instead of firing their own.
// Entries expire after their topic's max age; expired or unknown paths, and
// every non-GET request, go to the network as before.

const configured = String(import.meta.env?.VITE_API_BASE_URL ?? '/').trim();
export const LIVE_API_ORIGIN = (() => {
  try { return configured && configured !== '/' ? new URL(configured).origin : globalThis.location.origin; } catch { return globalThis.location?.origin || ''; }
})();
const BOOT_PATHS = new Set(GLOBAL_TOPICS.filter(topic => topic.boot !== false).map(topic => topic.path));
const store = new Map(); // path -> { body: string, receivedAt, maxAgeMs }
let bootPending = null;

export function rememberLive(path, body, { ageMs = 0, maxAgeMs = 30_000 } = {}) {
  if (typeof path !== 'string' || body == null) return;
  store.set(path, { body: typeof body === 'string' ? body : JSON.stringify(body), receivedAt: Date.now() - Math.max(0, ageMs), maxAgeMs });
  globalThis.dispatchEvent?.(new CustomEvent('funded:live-update', { detail: { path } }));
}

const freshEntry = path => {
  const entry = store.get(path);
  if (!entry) return null;
  if (Date.now() - entry.receivedAt > entry.maxAgeMs) { store.delete(path); return null; }
  return entry;
};
const cachedResponse = entry => new Response(entry.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-live-cache': 'browser' } });

export function installLiveCache() {
  if (globalThis.__richpadLiveCache || typeof globalThis.fetch !== 'function' || typeof Response !== 'function') return;
  globalThis.__richpadLiveCache = true;
  const original = globalThis.fetch.bind(globalThis);
  bootPending = original(`${LIVE_API_ORIGIN}/api/live/boot`, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout?.(4_000) })
    .then(response => response.ok ? response.json() : null)
    .then(boot => {
      if (!boot?.entries) return;
      const skew = Number(boot.serverTime) || Date.now();
      for (const [path, row] of Object.entries(boot.entries)) rememberLive(path, row.body, { ageMs: skew - Number(row.at), maxAgeMs: Number(row.maxAgeMs) || 30_000 });
    })
    .catch(() => {})
    .finally(() => { bootPending = null; });

  globalThis.fetch = function liveFetch(input, init = {}) {
    try {
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        // A write may change what the cached reads would return; Solana RPC POSTs are reads.
        const target = new URL(typeof input === 'string' ? input : input.url, globalThis.location.href);
        if (target.pathname !== '/api/solana/rpc') store.clear();
        return original(input, init);
      }
      if (init.body || init.signal?.aborted) return original(input, init);
      const url = new URL(typeof input === 'string' ? input : input.url, globalThis.location.href);
      if (url.origin !== LIVE_API_ORIGIN || !url.pathname.startsWith('/api/')) return original(input, init);
      const path = url.pathname + url.search;
      const hit = freshEntry(path);
      if (hit) return Promise.resolve(cachedResponse(hit));
      if (bootPending && BOOT_PATHS.has(path)) return bootPending.then(() => { const entry = freshEntry(path); return entry ? cachedResponse(entry) : original(input, init); });
    } catch {}
    return original(input, init);
  };
}

export const liveCacheSize = () => store.size;
