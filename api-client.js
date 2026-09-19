const CONFIGURED_API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE = CONFIGURED_API_BASE === '/' ? '' : CONFIGURED_API_BASE.replace(/\/$/, '');

export async function apiRequest(path, options = {}) {
  if (!CONFIGURED_API_BASE) return { available: false, data: null };
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `API request failed (${response.status}).`);
  return { available: true, data };
}

export async function persistLaunchPolicy(policy) {
  try { return await apiRequest('/api/launches', { method: 'POST', body: policy }); } catch { return { available: false, data: null }; }
}
