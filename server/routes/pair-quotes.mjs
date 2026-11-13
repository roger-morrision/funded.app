import { Connection } from '@solana/web3.js';

// Tokens a pump.fun coin can be paired with (its bonding curve's quote token):
// SOL, the program's whitelisted mints and the QuoteControl list. Read from the
// Pump program, named through Jupiter, grouped for the "Paired with" filter and
// the launch picker. Read-only; refreshed every 6 hours, last good list kept.
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLES = new Set(['USDC', 'USDT', 'USD1', 'PYUSD', 'USDG', 'USDS', 'USDE', 'FDUSD', 'EURC', 'USDH']);
const TTL_MS = 6 * 60 * 60_000;
// Devnet test tokens Jupiter does not list.
const KNOWN = { '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': { symbol: 'USDC', name: 'USD Coin (Devnet)', decimals: 6 } };

export function quoteCategory({ mint, symbol = '', name = '' }) {
  if (mint === WSOL_MINT) return 'sol';
  if (STABLES.has(String(symbol).toUpperCase())) return 'stable';
  if (/xstock/i.test(name)) return 'xstocks';
  if (/securities|prestock|tokenized stock|\bstock\b|\betf\b/i.test(name)) return 'stocks';
  return 'crypto';
}

async function jupiterNames(mints, fetchImpl) {
  const names = new Map();
  for (let index = 0; index < mints.length; index += 100) {
    const batch = mints.slice(index, index + 100);
    const rows = await fetchImpl(`https://lite-api.jup.ag/tokens/v2/search?query=${batch.join(',')}`, { signal: AbortSignal.timeout(15_000) })
      .then(response => response.ok ? response.json() : []).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) if (row?.id) names.set(row.id, row);
  }
  return names;
}

export function createPairQuotesRoute({ solanaRpcUrl, respond, fetchImpl = fetch, loadSdk = () => import('@pump-fun/pump-sdk') }) {
  let cache = null, loading = null;
  async function load() {
    const { OnlinePumpSdk } = await loadSdk();
    const sdk = new OnlinePumpSdk(new Connection(solanaRpcUrl, 'confirmed'));
    const rows = [...(await sdk.fetchSupportedQuoteMints())];
    const mints = rows.map(row => String(row.mint));
    const names = await jupiterNames(mints, fetchImpl);
    const quotes = rows.map(row => {
      const mint = String(row.mint), info = names.get(mint) || KNOWN[mint] || {};
      const symbol = mint === WSOL_MINT ? 'SOL' : String(info.symbol || '').slice(0, 20) || `${mint.slice(0, 4)}…${mint.slice(-4)}`;
      const name = mint === WSOL_MINT ? 'Solana' : String(info.name || '').slice(0, 80) || null;
      const icon = typeof info.icon === 'string' && info.icon.startsWith('https://') ? info.icon : null;
      return { mint, symbol, name, icon, source: row.source, decimals: Number.isInteger(info.decimals) ? info.decimals : null,
        tokenProgram: info.tokenProgram || null, category: quoteCategory({ mint, symbol: symbol || '', name: name || '' }),
        initialVirtualQuoteReserves: String(row.initialVirtualQuoteReserves ?? ''), usdPrice: Number(info.usdPrice) > 0 ? Number(info.usdPrice) : null };
    }).filter(row => row.symbol);
    return { quotes, checkedAt: new Date().toISOString() };
  }
  async function read() {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    loading ||= load().then(value => { cache = { at: Date.now(), value }; return value; }).finally(() => { loading = null; });
    try { return await loading; } catch (error) { if (cache) return cache.value; throw error; }
  }
  return {
    read,
    async handle(req, res, url) {
      if (req.method !== 'GET' || url.pathname !== '/api/pairs/quotes') return false;
      try { respond(res, 200, await read()); }
      catch { respond(res, 503, { error: 'Pair tokens are unavailable right now.' }); }
      return true;
    },
  };
}
