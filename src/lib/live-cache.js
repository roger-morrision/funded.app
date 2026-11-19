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
const inFlight = new Map(); // path -> pending shared network read
const MAX_ENTRIES = 200, MAX_BYTES = 4 * 1024 * 1024;
let storedBytes = 0, generation = 0;
const remove = path => { const entry = store.get(path); if (entry) storedBytes -= entry.bytes; store.delete(path); };
export function clearLiveCache() { generation++; store.clear(); inFlight.clear(); storedBytes = 0; }
export function sweepLiveCache() {
  for (const [path, entry] of store) if (Date.now() - entry.receivedAt >= entry.maxAgeMs) remove(path);
  while (store.size > MAX_ENTRIES || storedBytes > MAX_BYTES) remove(store.keys().next().value);
}

export function rememberLive(path, body, { ageMs = 0, maxAgeMs = 30_000, quiet = false } = {}) {
  if (typeof path !== 'string' || !liveTopic(path) || body == null) return;
  const encoded = typeof body === 'string' ? body : JSON.stringify(body), bytes = encoded.length * 2;
  remove(path);
  if (bytes > MAX_BYTES) return;
  store.set(path, { body: encoded, bytes, receivedAt: Date.now() - Math.max(0, ageMs), maxAgeMs });
  storedBytes += bytes;
  sweepLiveCache();
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
  if (Date.now() - entry.receivedAt >= entry.maxAgeMs) { remove(path); return null; }
  store.delete(path); store.set(path, entry);
  return entry;
};
const cachedResponse = entry => new Response(entry.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'x-live-cache': 'browser' } });

export function installLiveCache() {
  if (globalThis.__richpadLiveCache || typeof globalThis.fetch !== 'function' || typeof Response !== 'function') return;
  globalThis.__richpadLiveCache = true;
  const sweeper = setInterval(sweepLiveCache, 60_000);
  sweeper.unref?.();
  globalThis.addEventListener?.('hashchange', sweepLiveCache);
  globalThis.addEventListener?.('popstate', sweepLiveCache);
  globalThis.addEventListener?.('funded:wallet-change', clearLiveCache);
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = function liveFetch(input, init = {}) {
    try {
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input.url, globalThis.location.href);
      if (method !== 'GET' && method !== 'HEAD') {
        // A write may change what the cached reads would return; Solana RPC POSTs are reads.
        if (url.pathname !== '/api/solana/rpc') clearLiveCache();
        return original(input, init);
      }
      if (input instanceof Request || method !== 'GET' || init.body || init.signal?.aborted
        || [...new Headers(init.headers).keys()].length || init.credentials === 'include'
        || (init.cache && init.cache !== 'default')
        || url.origin !== LIVE_API_ORIGIN || !url.pathname.startsWith('/api/')) return original(input, init);
      const path = url.pathname + url.search;
      const topic = liveTopic(path);
      if (!topic) return original(input, init);
      const hit = freshEntry(path);
      if (hit) return Promise.resolve(cachedResponse(hit));
      if (method !== 'GET') return original(input, init);
      // Network read, shared by every caller asking for this path while it is in flight,
      // and kept so the next poll of this path is answered locally.
      let shared = inFlight.get(path);
      if (!shared) {
        const { signal, ...rest } = init; // one caller's timeout must not cancel the others' read
        const startedGeneration = generation;
        shared = original(input, rest).then(async response => {
          const body = await response.text();
          const contentType = response.headers.get('content-type') || '';
          if (startedGeneration === generation && response.ok && contentType.includes('application/json')
            && !/private|no-store/i.test(response.headers.get('cache-control') || '')) rememberLive(path, body, { maxAgeMs: topic.intervalMs, quiet: true });
          return { status: response.status, statusText: response.statusText, body, headers: response.headers };
        }).finally(() => { if (inFlight.get(path) === shared) inFlight.delete(path); });
        inFlight.set(path, shared);
      }
      const answer = shared.then(row => new Response([204,205,304].includes(row.status) ? null : row.body, { status: row.status, statusText: row.statusText, headers: row.headers }));
      if (!init.signal) return answer;
      return new Promise((resolve, reject) => {
        const abort = () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        init.signal.addEventListener('abort', abort, { once: true });
        answer.then(resolve, reject).finally(() => init.signal.removeEventListener('abort', abort));
      });
    } catch {}
    return original(input, init);
  };
}

export const liveCacheSize = () => store.size;
