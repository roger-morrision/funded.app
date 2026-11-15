import { liveTopic } from './live-topics.js';

// Browser side of the live data layer.
// - Every read is its own request, so each section shows as soon as its own
//   data arrives (the server answers these from its snapshot cache; no read
//   waits for another).
// - Responses for live topic paths, and snapshots pushed over /api/live (see
//   live-socket.js), are kept for a short time. A thin fetch layer answers
//   repeat GETs for those exact paths from here, so page pollers stop hitting
//   the network while the socket keeps the data current.
// Entries expire after their topic's max age; expired or unknown paths, and
// every non-GET request, go to the network as before.

const configured = String(import.meta.env?.VITE_API_BASE_URL ?? '/').trim();
export const LIVE_API_ORIGIN = (() => {
  try { return configured && configured !== '/' ? new URL(configured).origin : globalThis.location.origin; } catch { return globalThis.location?.origin || ''; }
})();
const store = new Map(); // path -> { body: string, receivedAt, maxAgeMs }

export function rememberLive(path, body, { ageMs = 0, maxAgeMs = 30_000, quiet = false } = {}) {
  if (typeof path !== 'string' || body == null) return;
  store.set(path, { body: typeof body === 'string' ? body : JSON.stringify(body), receivedAt: Date.now() - Math.max(0, ageMs), maxAgeMs });
  if (!quiet) globalThis.dispatchEvent?.(new CustomEvent('funded:live-update', { detail: { path } }));
}

// The server confirmed this path is unchanged: keep the local copy current.
export function confirmLive(path, { ageMs = 0, maxAgeMs } = {}) {
  const entry = store.get(path);
  if (!entry) return;
  entry.receivedAt = Date.now() - Math.max(0, ageMs);
  if (maxAgeMs) entry.maxAgeMs = maxAgeMs;
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

  globalThis.fetch = function liveFetch(input, init = {}) {
    try {
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input.url, globalThis.location.href);
      if (method !== 'GET' && method !== 'HEAD') {
        // A write may change what the cached reads would return; Solana RPC POSTs are reads.
        if (url.pathname !== '/api/solana/rpc') store.clear();
        return original(input, init);
      }
      if (init.body || init.signal?.aborted || url.origin !== LIVE_API_ORIGIN || !url.pathname.startsWith('/api/')) return original(input, init);
      const path = url.pathname + url.search;
      const topic = liveTopic(path);
      if (!topic) return original(input, init);
      const hit = freshEntry(path);
      if (hit) return Promise.resolve(cachedResponse(hit));
      // Network read: keep a copy so the next poll of this path is answered locally.
      return original(input, init).then(response => {
        if (response.ok && method === 'GET' && String(response.headers.get('content-type')).includes('application/json'))
          response.clone().text().then(body => rememberLive(path, body, { maxAgeMs: topic.intervalMs, quiet: true })).catch(() => {});
        return response;
      });
    } catch {}
    return original(input, init);
  };
}

export const liveCacheSize = () => store.size;
