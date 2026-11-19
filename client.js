import { beginApiTiming } from './src/features/experience/flow-timing.js';
import { publicReadFetch } from './src/lib/public-read-fetch.js';
import { assertWritablePreview } from './deployment-mode.js';
// Solana hosts the API on the same origin. Keep that route available even when
// an image build accidentally passes an empty VITE_API_BASE_URL.
const CONFIGURED_API_BASE = String(import.meta.env?.VITE_API_BASE_URL || (String(import.meta.env?.VITE_SOLANA_CLUSTER || 'devnet') === 'devnet' ? '/' : '')).trim();
const API_BASE = CONFIGURED_API_BASE === '/' ? '' : CONFIGURED_API_BASE.replace(/\/$/, '');

// Public in-flight sharing lives in publicReadFetch. Personalized reads and
// completed responses are never reused here, and a 503 cannot poison another URL.
export async function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET','HEAD','OPTIONS'].includes(method)) assertWritablePreview();
  if (!CONFIGURED_API_BASE) return { available: false, data: null };
  return requestApi(path, options);
}
async function requestApi(path, options) {
  const finishTiming = beginApiTiming(path);
  try {
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
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
