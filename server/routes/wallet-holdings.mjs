import { PublicKey } from '@solana/web3.js';

// Public wallet holdings (any address): SOL balance and SPL / Token-2022 balances,
// with symbol, logo and USD price from indexed market data. Read-only; cached 60 s.
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EH5JBT5gH7r2uX8a5Ug8';
const WSOL = 'So11111111111111111111111111111111111111112';

export function createWalletHoldingsRoute({ connection, free, respond }) {
  const cache = new Map();
  const json = (...args) => { respond(...args); return true; };
  async function load(owner) {
    const key = new PublicKey(owner), rpc = connection();
    const [lamports, ...programs] = await Promise.all([
      rpc.getBalance(key, 'confirmed'),
      ...[TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map(programId => rpc.getParsedTokenAccountsByOwner(key, { programId: new PublicKey(programId) }, 'confirmed').catch(() => ({ value: [] }))),
    ]);
    const byMint = new Map();
    for (const program of programs) for (const row of program.value || []) {
      const info = row.account?.data?.parsed?.info, amount = info?.tokenAmount;
      if (!info?.mint || info.mint === WSOL || !amount || amount.amount === '0') continue;
      const prior = byMint.get(info.mint);
      const quantity = Number(amount.uiAmountString || amount.uiAmount || 0) + (prior?.quantity || 0);
      byMint.set(info.mint, { mint: info.mint, quantity, decimals: amount.decimals });
    }
    const mints = [...byMint.keys()].slice(0, 60);
    const [dex, jup] = await Promise.all([free.dexTokens(mints).catch(() => new Map()), free.jupPrices(mints).catch(() => new Map())]);
    // Names, symbols and logos missing from DexScreener come from Jupiter's token list.
    const named = new Map(await Promise.all(mints.filter(mint => !dex.get(mint)?.symbol).slice(0, 20)
      .map(async mint => [mint, await free.jupToken?.(mint).catch(() => null)])));
    const accounts = mints.map(mint => {
      const row = byMint.get(mint), market = dex.get(mint) || {}, info = named.get(mint) || {}, price = Number(market.priceUsd ?? jup.get(mint)?.priceUsd);
      return { ...row, market: { symbol: market.symbol || info.symbol || null, name: market.name || info.name || null,
        logoUri: market.imageUri || (typeof info.icon === 'string' && info.icon.startsWith('https://') ? info.icon : null), priceUsd: Number.isFinite(price) && price > 0 ? price : null },
        valueUsd: Number.isFinite(price) && price > 0 ? row.quantity * price : null };
    }).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    return { wallet: owner, solLamports: String(lamports), accounts, checkedAt: new Date().toISOString() };
  }
  return async function handleWalletHoldings(req, res, url) {
    const match = req.method === 'GET' && /^\/api\/wallets\/([^/]+)\/holdings$/.exec(url.pathname);
    if (!match) return false;
    let owner;
    try { owner = new PublicKey(decodeURIComponent(match[1])).toBase58(); } catch { return json(res, 400, { error: 'A valid Solana wallet is required.' }); }
    const hit = cache.get(owner);
    if (hit && Date.now() - hit.at < 60_000) return json(res, 200, await hit.value);
    const value = load(owner);
    cache.set(owner, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    try { return json(res, 200, await value); }
    catch { cache.delete(owner); return json(res, 503, { error: 'Wallet holdings are unavailable right now.' }); }
  };
}
