// Token header numbers come from several sources (RPC snapshot, DEX index, live
// refresh) that finish in any order. The RPC snapshot writes "$—" when it has no
// SOL price yet, which used to blank a value the index had already shown.
// Rules: while a coin page is open, a dash never replaces a real number, empty
// slots read "Loading…" (rendered as a shimmer by skeletons.js), and the last
// good values are cached per coin so a revisit shows numbers at once.
const FIELDS = ['coin-price', 'coin-change', 'coin-market-cap', 'coin-strip-market-cap', 'coin-liquidity',
  'coin-holder-count', 'coin-strip-volume', 'coin-strip-trades'];
const CACHE_KEY = 'richpad.coin-header.v1';
const CACHE_AGE_MS = 30 * 60_000;
const CACHE_LIMIT = 24;
const SETTLE_MS = 15_000;
const LOADING = 'Loading…';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isHeaderPlaceholder(text) {
  const value = String(text ?? '').trim();
  return value === '' || /^(?:\$?—|24h —|—\s*·\s*24h)$/.test(value) || /^(checking|loading|reading)\b[^.]{0,30}…$/i.test(value);
}

export function coinMintFromLocation(location = globalThis.location) {
  const path = /^\/(?:token|launch\/coin)\/([^/?#]+)/.exec(location?.pathname || '')?.[1];
  const hash = /^#coin\/([^/?#]+)/.exec(location?.hash || '')?.[1];
  const mint = (location?.hash && !hash ? '' : hash || path) || '';
  return MINT.test(mint) ? mint : '';
}

export function readHeaderCache(storage, mint, now = Date.now()) {
  try {
    const entry = JSON.parse(storage?.getItem(CACHE_KEY) || '{}')?.[mint];
    return entry && now - entry.at <= CACHE_AGE_MS && entry.values && typeof entry.values === 'object' ? entry.values : null;
  } catch { return null; }
}

export function writeHeaderCache(storage, mint, values, now = Date.now()) {
  try {
    const all = JSON.parse(storage?.getItem(CACHE_KEY) || '{}') || {};
    all[mint] = { at: now, values };
    const kept = Object.entries(all).filter(([, entry]) => now - entry?.at <= CACHE_AGE_MS)
      .sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT);
    storage?.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* storage is optional */ }
}

export function mountCoinHeaderHold(document = globalThis.document, { storage = globalThis.localStorage, location = globalThis.location, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  const nodes = FIELDS.map(id => document.getElementById(id)).filter(Boolean);
  if (!nodes.length) return false;
  let mint = '', good = new Map(), settled = false, timer = 0, saveTimer = 0;
  const save = () => {
    saveTimer = 0;
    if (mint && good.size) writeHeaderCache(storage, mint, Object.fromEntries(good));
  };
  const apply = node => {
    const text = node.textContent;
    if (!isHeaderPlaceholder(text)) {
      if (good.get(node.id) !== text) { good.set(node.id, text); if (!saveTimer) saveTimer = setTimer(save, 500); }
      return;
    }
    const keep = good.get(node.id);
    if (keep != null) { node.textContent = keep; return; }
    // Until the sources settle, an empty slot is still loading, not unavailable.
    if (!settled && text !== LOADING) node.textContent = LOADING;
  };
  const start = () => {
    mint = coinMintFromLocation(location);
    good = new Map(); settled = false;
    clearTimer(timer); timer = setTimer(() => {
      settled = true;
      for (const node of nodes) if (node.textContent === LOADING) node.textContent = '—';
    }, SETTLE_MS);
    const cached = mint ? readHeaderCache(storage, mint) : null;
    for (const node of nodes) {
      const value = cached?.[node.id];
      if (typeof value === 'string' && !isHeaderPlaceholder(value)) { good.set(node.id, value); node.textContent = value; }
      else apply(node);
    }
  };
  const observer = new MutationObserver(records => {
    if (!mint) return;
    for (const node of new Set(records.map(record => record.target.nodeType === 1 ? record.target : record.target.parentElement))) {
      const field = nodes.find(candidate => candidate === node || candidate.contains(node));
      if (field) apply(field);
    }
  });
  for (const node of nodes) observer.observe(node, { childList: true, characterData: true, subtree: true });
  globalThis.addEventListener?.('funded:coin-facts-loading', start);
  if (coinMintFromLocation(location)) start();
  return true;
}
