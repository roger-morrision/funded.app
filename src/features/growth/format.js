// Shared helpers for the growth features. Amounts arrive as integer lamport strings.
export const LAMPORTS = 1_000_000_000n;
export function lamports(value) {
  return /^(0|[1-9]\d*)$/.test(String(value ?? '')) ? BigInt(value) : null;
}
export function sol(value, digits = 4) {
  const n = typeof value === 'bigint' ? value : lamports(value);
  if (n == null) return '—';
  const whole = n / LAMPORTS, fraction = String(n % LAMPORTS).padStart(9, '0').slice(0, digits).replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
}
export const shortWallet = wallet => wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : '';
export function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
export function nextUtcHour(now = Date.now()) { const d = new Date(now); d.setUTCMinutes(60, 0, 0); return d.getTime(); }
export function nextUtcMidnight(now = Date.now()) { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
export function countdown(target, now = Date.now()) {
  const s = Math.max(0, Math.round((target - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}
export const safeStorage = {
  get(key) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set(key, value) { try { globalThis.localStorage?.setItem(key, value); } catch { /* unavailable */ } },
  remove(key) { try { globalThis.localStorage?.removeItem(key); } catch { /* unavailable */ } },
};
// Fetch JSON with a timeout; never throws, returns null on any failure.
export async function getJSON(url, { timeout = 20000 } = {}) {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeout) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
