// Top 100 ranking and filters live in `top.*` query parameters so a view can be
// shared or reloaded. The hash route (#top100) is left untouched.
const KEYS = {sort:'top.sort', query:'top.q', stage:'top.stage', tier:'top.tier', minCap:'top.cap', maxAge:'top.age'};
const DEFAULTS = {sort:'featured', query:'', stage:'all', tier:'all', minCap:0, maxAge:0};
const NUMERIC = new Set(['minCap','maxAge']);

// Reads saved filters, keeping only values the page offers (allowed: key → list of values).
export function readTop100Url(search, allowed) {
  const params = new URLSearchParams(search), out = {};
  for (const [key, name] of Object.entries(KEYS)) {
    const raw = params.get(name);
    if (raw == null || raw === '') continue;
    if (key === 'query') { out.query = raw.slice(0, 100); continue; }
    if (!allowed[key]?.includes(raw)) continue;
    out[key] = NUMERIC.has(key) ? Number(raw) : raw;
  }
  return out;
}

// Returns the search string for the filters; defaults are omitted. Other parameters are kept.
export function top100Search(search, filters) {
  const params = new URLSearchParams(search);
  for (const [key, name] of Object.entries(KEYS)) {
    const value = filters[key];
    if (value == null || value === DEFAULTS[key] || String(value).trim() === '') params.delete(name);
    else params.set(name, key === 'query' ? String(value).trim().slice(0, 100) : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
