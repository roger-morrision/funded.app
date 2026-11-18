// Quick-buy amounts (SOL) shown on coin cards and in table Buy menus. Each
// browser keeps its own three amounts, set from the wallet profile page.
const KEY = 'richpad.quick-buy-presets.v1';
export const DEFAULT_QUICK_BUY = ['0.5', '1', '2'];
const valid = value => /^\d+(?:\.\d{1,4})?$/.test(String(value)) && Number(value) > 0 && Number(value) <= 100;
const tidy = value => String(Number(value));

export function readQuickBuyPresets(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null');
    if (Array.isArray(saved) && saved.length === 3 && saved.every(valid)) return saved.map(tidy);
  } catch { /* fall back to defaults */ }
  return [...DEFAULT_QUICK_BUY];
}

export function saveQuickBuyPresets(values, storage = globalThis.localStorage) {
  const list = values.map(value => String(value).trim());
  if (list.length !== 3 || !list.every(valid)) throw new Error('Enter three amounts between 0.0001 and 100 SOL.');
  const sorted = [...new Set(list.map(tidy))].sort((a, b) => Number(a) - Number(b));
  if (sorted.length !== 3) throw new Error('Use three different amounts.');
  try { storage?.setItem(KEY, JSON.stringify(sorted)); } catch { throw new Error('This browser blocked saving. Allow site storage and try again.'); }
  globalThis.dispatchEvent?.(new CustomEvent('funded:quick-buy-presets', { detail: sorted }));
  return sorted;
}

export function resetQuickBuyPresets(storage = globalThis.localStorage) {
  try { storage?.removeItem(KEY); } catch { /* optional */ }
  globalThis.dispatchEvent?.(new CustomEvent('funded:quick-buy-presets', { detail: [...DEFAULT_QUICK_BUY] }));
  return [...DEFAULT_QUICK_BUY];
}

// Links the existing quick-buy handler understands (".has-buy-presets a.card-review-buy").
export function quickBuyLinksMarkup(item, escapeHtml, presets = readQuickBuyPresets(), extra = '') {
  const mint = escapeHtml(item.address || '');
  return presets.map(amount => `<a class="card-review-buy"${extra} data-review-buy="${mint}" data-review-amount="${amount}" data-symbol="${escapeHtml(item.symbol || '')}" data-dex="${escapeHtml(item.dexId || '')}" data-quote="${escapeHtml(item.quoteMint || '')}" href="/token/${encodeURIComponent(item.address || '')}?reviewBuy=${amount}" title="Buy ${amount} SOL">Buy ${amount} SOL</a>`).join('');
}
