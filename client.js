import { beginApiTiming } from './src/features/experience/flow-timing.js';
import { publicReadFetch } from './src/lib/public-read-fetch.js';
import { assertWritablePreview } from './deployment-mode.js';
// Solana hosts the API on the same origin. Keep that route available even when
// an image build accidentally passes an empty VITE_API_BASE_URL.
const CONFIGURED_API_BASE = String(import.meta.env?.VITE_API_BASE_URL || (String(import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet') === 'devnet' ? '/' : '')).trim();
const API_BASE = CONFIGURED_API_BASE === '/' ? '' : CONFIGURED_API_BASE.replace(/\/$/, '');

// Identical GETs made while one is in flight (or within 2 s) share one response;
// a path the server refused as unavailable (503) is not re-requested for a minute.
const recentGets = new Map(), unavailablePaths = new Map();
// Public reads that change slowly are reused for 30 s across page switches.
const SHARED_READS = /^\/api\/(?:boosts|launches|listings|buyback\/status|evidence\/(?:payment-history|receipts)|analytics\/summary|rewards\/experience|fee-policy|capabilities|service-fees|home\/featured)(?:\?|$)/;
const reuseWindow = path => SHARED_READS.test(String(path)) ? 30_000 : 2000;
export async function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET','HEAD','OPTIONS'].includes(method)) { assertWritablePreview(); recentGets.clear(); }
  if (!CONFIGURED_API_BASE) return { available: false, data: null };
  if (method === 'GET' && !options.body && !options.cache) {
    const bare = String(path).split('?')[0], refused = unavailablePaths.get(bare);
    if (refused && refused.until > Date.now()) { const error = new Error(refused.message); error.status = 503; throw error; }
    const hit = recentGets.get(path);
    if (hit && (hit.pending || hit.at > Date.now() - reuseWindow(path))) return hit.promise.then(result => ({ ...result }));
    const promise = requestApi(path, options).catch(error => {
      if (error?.status === 503) unavailablePaths.set(bare, { until: Date.now() + 60_000, message: error.message });
      recentGets.delete(path); throw error;
    });
    const entry = { promise, pending: true, at: 0 }; recentGets.set(path, entry);
    promise.then(() => { entry.pending = false; entry.at = Date.now(); }, () => {});
    if (recentGets.size > 200) for (const [key, row] of recentGets) if (!row.pending && row.at < Date.now() - reuseWindow(key)) recentGets.delete(key);
    return promise.then(result => ({ ...result }));
  }
  return requestApi(path, options);
}
async function requestApi(path, options) {
  const finishTiming = beginApiTiming(path);
  try {
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  const response = await publicReadFetch(`${API_BASE}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const isJson = response.headers.get('content-type')?.toLowerCase().includes('application/json');
    const fallback = !isJson && response.status >= 500
      ? 'Service temporarily unavailable. Check the action’s status before retrying.'
      : `API request failed (${response.status}).`;
    const error = new Error(data.error || fallback);
    error.status = response.status;
    throw error;
  }
  finishTiming(response.status === 202 ? 'pending' : 'available');
  return { available: true, data };
  } catch (error) { finishTiming('unavailable'); throw error; }
}

export async function persistLaunchPolicy(policy) {
  try { return await apiRequest('/api/launches', { method: 'POST', body: policy }); } catch { return { available: false, data: null }; }
}
