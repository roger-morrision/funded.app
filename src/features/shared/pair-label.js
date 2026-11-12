// "Paired with": the token a coin trades against (its pool or bonding-curve
// quote). Pump.fun coins can be paired with SOL, USDC, xStocks, stocks and
// other tokens on Pump's list; /api/pairs/quotes names and groups that list.
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const PAIR_CATEGORIES = [
  ['all', 'All pairs'], ['sol', 'SOL'], ['stable', 'Stablecoins'], ['xstocks', 'xStocks'], ['stocks', 'Stocks'], ['crypto', 'Crypto'], ['custom', 'Other'],
];
const CATEGORY_LABEL = { sol: 'Solana', stable: 'Stablecoin', xstocks: 'xStock', stocks: 'Stock', crypto: 'Crypto', custom: 'Custom' };

let quotes = null, loading = null;
const byMint = new Map();

export function loadPairQuotes(request = path => fetch(path).then(response => response.ok ? response.json() : Promise.reject(new Error('unavailable')))) {
  if (quotes) return Promise.resolve(quotes);
  loading ||= Promise.resolve(request('/api/pairs/quotes')).then(result => {
    const list = Array.isArray(result?.quotes) ? result.quotes : Array.isArray(result?.data?.quotes) ? result.data.quotes : [];
    quotes = list;
    for (const row of list) byMint.set(row.mint, row);
    globalThis.dispatchEvent?.(new CustomEvent('funded:pair-quotes', { detail: { count: list.length } }));
    return list;
  }).catch(() => { loading = null; return []; });
  return loading;
}

export const pairQuotes = () => quotes || [];
export const pairQuote = mint => byMint.get(mint) || null;

// The pair of a token row: its quote mint and symbol, and the filter category.
export function tokenPair(item) {
  const mint = String(item?.quoteMint || '');
  if (!mint && !item?.quoteSymbol) return null;
  if (mint === WSOL_MINT) return { mint, symbol: 'SOL', category: 'sol', label: CATEGORY_LABEL.sol };
  const known = byMint.get(mint);
  const symbol = String(known?.symbol || item.quoteSymbol || '').replace(/^\$/, '') || null;
  if (!symbol) return null;
  if (/^(?:SOL|WSOL)$/i.test(symbol)) return { mint, symbol: 'SOL', category: 'sol', label: CATEGORY_LABEL.sol };
  const category = known?.category || (/^(?:USDC|USDT|USD1|PYUSD)$/i.test(symbol) ? 'stable' : 'custom');
  return { mint, symbol, name: known?.name || null, icon: known?.icon || null, category, label: CATEGORY_LABEL[category] || 'Custom' };
}

export function pairChipMarkup(item, escapeHtml) {
  const pair = tokenPair(item);
  if (!pair) return '';
  return `<span class="pair-chip pair-${escapeHtml(pair.category)}" title="Paired with ${escapeHtml(pair.name || pair.symbol)} · ${escapeHtml(pair.label)}"><small>Paired with</small><b>${escapeHtml(pair.symbol)}</b></span>`;
}

export function matchesPairFilter(item, filter) {
  if (!filter || filter === 'all') return true;
  const pair = tokenPair(item);
  return pair ? pair.category === filter : filter === 'sol';
}
