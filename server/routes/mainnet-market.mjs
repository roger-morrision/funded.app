import { Connection, PublicKey, AddressLookupTableAccount } from '@solana/web3.js';
import { WSOL, dexMarketActivity } from '../free-market-data.mjs';

// Mainnet external-token data: free sources first (DexScreener, Jupiter,
// GeckoTerminal), paid Birdeye only as fallback. Results are written to the
// discovered-token cache so later page loads render from the database.
export function createMainnetMarketRoutes({ solanaCluster, solanaRpcUrl, free, tokenCache, fetchBirdeye, readMarketFallback, store, clientKey, body, respond }) {
  const json = (...args) => { respond(...args); return true; };
  const altCache = new Map();
  let rpc;
  const connection = () => rpc ||= new Connection(solanaRpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  const decimalsCache = new Map(), holdersCache = new Map(), holderCountCache = new Map();
  async function holderCount(mint) {
    const hit = holderCountCache.get(mint);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
    const gecko = await free.geckoTokenInfo(mint).catch(() => null);
    let value = Number.isSafeInteger(gecko?.holders?.count) ? gecko.holders.count : null;
    if (value == null) { const jupInfo = await free.jupToken(mint).catch(() => null); if (Number.isSafeInteger(jupInfo?.holderCount)) value = jupInfo.holderCount; }
    if (value == null) {
      const result = await fetchBirdeye('/defi/token_overview', { address: mint }).catch(() => null);
      value = Number.isSafeInteger(result?.data?.holder) ? result.data.holder : hit?.value ?? null;
    }
    holderCountCache.set(mint, { at: Date.now(), value });
    if (holderCountCache.size > 2000) holderCountCache.delete(holderCountCache.keys().next().value);
    return value;
  }
  async function topHolders(mint) {
    const hit = holdersCache.get(mint);
    if (hit && Date.now() - hit.at < (hit.value.source === 'birdeye' ? 600_000 : 60_000)) return hit.value;
    const value = await rpcHolders(mint).catch(() => null) || await birdeyeHolders(mint).catch(() => null);
    if (!value) return hit?.value || null;
    holdersCache.set(mint, { at: Date.now(), value });
    if (holdersCache.size > 1000) holdersCache.delete(holdersCache.keys().next().value);
    return value;
  }
  async function birdeyeHolders(mint) {
    const result = await fetchBirdeye('/defi/v3/token/holder', { address: mint, offset: '0', limit: '20' });
    const items = Array.isArray(result?.data?.items) ? result.data.items : null;
    if (!items?.length) return null;
    const cached = (await tokenCache.read([mint]).catch(() => new Map())).get(mint);
    const decimals = Number.isInteger(items[0].decimals) ? items[0].decimals : cached?.decimals;
    const supply = cached?.marketCapUsd > 0 && cached?.priceUsd > 0 ? cached.marketCapUsd / cached.priceUsd : null;
    const holders = items.flatMap(row => typeof row?.owner === 'string' && /^\d+$/.test(String(row.amount)) ? [{ wallet: row.owner, address: row.token_account || null,
      amountRaw: String(row.amount), share: supply && Number.isFinite(Number(row.ui_amount)) ? Number(row.ui_amount) / supply * 100 : null }] : []);
    return holders.length ? { source: 'birdeye', decimals: Number.isInteger(decimals) ? decimals : 6, holders } : null;
  }
  async function rpcHolders(mint) {
    const key = new PublicKey(mint);
    const [largest, supply] = await Promise.all([connection().getTokenLargestAccounts(key, 'confirmed'), connection().getTokenSupply(key, 'confirmed')]);
    const accounts = largest.value.slice(0, 20);
    const infos = await connection().getMultipleParsedAccounts(accounts.map(row => row.address), { commitment: 'confirmed' });
    const total = BigInt(supply.value.amount);
    const holders = accounts.flatMap((row, index) => {
      const owner = infos.value[index]?.data?.parsed?.info?.owner;
      if (!owner || BigInt(row.amount) === 0n) return [];
      return [{ wallet: owner, address: row.address.toBase58(), amountRaw: row.amount, share: total > 0n ? Number(BigInt(row.amount) * 1_000_000n / total) / 10_000 : null }];
    });
    return holders.length ? { source: 'rpc', decimals: supply.value.decimals, supplyRaw: supply.value.amount, holders } : null;
  }
  async function mintDecimals(mint) {
    if (decimalsCache.has(mint)) return decimalsCache.get(mint);
    const info = await connection().getParsedAccountInfo(new PublicKey(mint), 'confirmed').catch(() => null);
    const decimals = info?.value?.data?.parsed?.info?.decimals;
    if (Number.isInteger(decimals)) { decimalsCache.set(mint, decimals); if (decimalsCache.size > 5000) decimalsCache.delete(decimalsCache.keys().next().value); }
    return decimals;
  }
  const validMint = value => { try { return new PublicKey(String(value || '')).toBase58() === value; } catch { return false; } };

  async function overview(mint) {
    const [dex, jup, cached] = await Promise.all([free.dexTokens([mint]).then(m => m.get(mint)).catch(() => null),
      free.jupPrices([mint]).then(m => m.get(mint)).catch(() => null), tokenCache.read([mint]).then(m => m.get(mint)).catch(() => null)]);
    let row = dex ? { ...dex } : null;
    if (row && jup) row = { ...row, priceUsd: row.priceUsd ?? jup.priceUsd, decimals: jup.decimals, launchpad: jup.launchpad };
    let source = row ? 'dexscreener' : null;
    if (!row) {
      const birdeye = await readMarketFallback(mint).catch(() => null);
      if (birdeye) { row = { ...birdeye, decimals: jup?.decimals ?? null, launchpad: jup?.launchpad ?? null }; source = 'birdeye'; }
      else if (jup) { row = { mint, priceUsd: jup.priceUsd, decimals: jup.decimals, liquidityUsd: jup.liquidityUsd, launchpad: jup.launchpad }; source = 'jupiter'; }
    }
    if (!row) return cached ? { ...cached, source: 'cache', stale: true } : null;
    // DexScreener only has artwork for tokens with a paid profile; fill the logo
    // (and missing identity) from Jupiter's token list, then GeckoTerminal.
    if (!row.imageUri && !cached?.imageUri) {
      const jupInfo = await free.jupToken(mint).catch(() => null);
      let logo = typeof jupInfo?.icon === 'string' && jupInfo.icon.startsWith('https://') ? jupInfo.icon : null;
      if (!logo) { const gecko = await free.geckoTokenInfo(mint).catch(() => null); logo = typeof gecko?.image_url === 'string' && gecko.image_url.startsWith('https://') ? gecko.image_url : null; }
      if (logo) row = { ...row, imageUri: logo };
      if (!row.name && jupInfo?.name) row = { ...row, name: String(jupInfo.name).slice(0, 80) };
      if (!row.symbol && jupInfo?.symbol) row = { ...row, symbol: String(jupInfo.symbol).slice(0, 20) };
    }
    const merged = { ...(cached || {}), ...Object.fromEntries(Object.entries(row).filter(([, v]) => v != null)), mint, source, observedAt: new Date().toISOString() };
    void tokenCache.upsert([merged]);
    return merged;
  }

  return async function handleMainnetMarketRoutes(req, res, url) {
    if (solanaCluster !== 'mainnet-beta') return false;
    const overviewMatch = req.method === 'GET' && /^\/api\/tokens\/([^/]+)\/overview$/.exec(url.pathname);
    if (overviewMatch) {
      const mint = decodeURIComponent(overviewMatch[1]);
      if (!validMint(mint)) return json(res, 400, { error: 'A valid Solana mint is required.' });
      const data = await overview(mint);
      return data ? json(res, 200, { cluster: solanaCluster, ...data }) : json(res, 404, { error: 'No market data was found for this token.' });
    }
    const ohlcvMatch = req.method === 'GET' && /^\/api\/tokens\/([^/]+)\/ohlcv$/.exec(url.pathname);
    if (ohlcvMatch) {
      const mint = decodeURIComponent(ohlcvMatch[1]), frame = Object.hasOwn(free.GECKO_FRAMES, url.searchParams.get('frame')) ? url.searchParams.get('frame') : '15m';
      if (!validMint(mint)) return json(res, 400, { error: 'A valid Solana mint is required.' });
      let pool = (await tokenCache.read([mint])).get(mint)?.pairAddress;
      if (!pool) pool = (await free.dexTokens([mint]).catch(() => new Map())).get(mint)?.pairAddress;
      let candles = pool ? await free.geckoOhlcv(pool, frame).catch(() => null) : null, source = 'geckoterminal';
      if (!candles?.length) {
        const seconds = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[frame], to = Math.floor(Date.now() / 1000);
        const type = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' }[frame];
        const result = await fetchBirdeye('/defi/ohlcv', { address: mint, type, time_from: String(to - seconds * 300), time_to: String(to) }).catch(() => null);
        candles = Array.isArray(result?.data?.items) ? result.data.items.map(row => ({ time: row.unixTime, open: row.o, high: row.h, low: row.l, close: row.c, volume: row.v }))
          .filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite)) : [];
        source = 'birdeye';
      }
      return json(res, 200, { cluster: solanaCluster, mint, frame, source, pool: pool || null, candles });
    }
    const holdersMatch = req.method === 'GET' && /^\/api\/tokens\/([^/]+)\/holders$/.exec(url.pathname);
    if (holdersMatch) {
      const mint = decodeURIComponent(holdersMatch[1]);
      if (!validMint(mint)) return json(res, 400, { error: 'A valid Solana mint is required.' });
      const [top, count] = await Promise.all([topHolders(mint).catch(() => null), holderCount(mint).catch(() => null)]);
      return json(res, 200, { cluster: solanaCluster, mint, available: Boolean(top), holderCount: count, ...(top || { holders: [] }) });
    }
    const tradesMatch = req.method === 'GET' && /^\/api\/tokens\/([^/]+)\/trades$/.exec(url.pathname);
    if (tradesMatch) {
      const mint = decodeURIComponent(tradesMatch[1]);
      if (!validMint(mint)) return json(res, 400, { error: 'A valid Solana mint is required.' });
      const cached = (await tokenCache.read([mint])).get(mint);
      const market = cached?.pairAddress ? cached : (await free.dexTokens([mint]).catch(() => new Map())).get(mint);
      const pool = market?.pairAddress;
      const [rows, prices] = await Promise.all([pool ? free.geckoTrades(pool).catch(() => null) : null, free.jupPrices([mint, WSOL]).catch(() => new Map())]);
      let decimals = prices.get(mint)?.decimals ?? cached?.decimals;
      if (!Number.isInteger(decimals) && rows?.length) {
        decimals = await mintDecimals(mint);
        if (Number.isInteger(decimals)) void tokenCache.upsert([{ ...(cached || market || {}), mint, decimals }]);
      }
      const solUsd = prices.get(WSOL)?.priceUsd;
      if (!Array.isArray(rows) || !Number.isInteger(decimals)) return json(res, 200, { cluster: solanaCluster, mint, source: 'geckoterminal', available: false, trades: [] });
      const trades = rows.flatMap(row => {
        const side = row.kind === 'buy' ? 'buy' : row.kind === 'sell' ? 'sell' : null;
        const tokenAmount = Number(side === 'buy' ? row.to_token_amount : row.from_token_amount);
        const quoteAddress = side === 'buy' ? row.from_token_address : row.to_token_address;
        const quoteAmount = Number(side === 'buy' ? row.from_token_amount : row.to_token_amount);
        const sol = quoteAddress === WSOL ? quoteAmount : Number(row.volume_in_usd) / solUsd;
        const blockTime = Math.floor(Date.parse(row.block_timestamp) / 1000);
        if (!side || !Number.isFinite(tokenAmount) || !Number.isFinite(sol) || !Number.isFinite(blockTime) || typeof row.tx_hash !== 'string') return [];
        return [{ signature: row.tx_hash, blockTime, side, trader: typeof row.tx_from_address === 'string' ? row.tx_from_address : null,
          solLamports: String(Math.round(sol * 1e9)), tokenAmountRaw: BigInt(Math.round(tokenAmount * 10 ** Math.min(decimals, 9))).toString() + '0'.repeat(Math.max(0, decimals - 9)),
          usd: Number(row.volume_in_usd) || null }];
      });
      return json(res, 200, { cluster: solanaCluster, mint, source: 'geckoterminal', available: true, pool, decimals, trades });
    }
    if (req.method === 'POST' && url.pathname === '/api/trade/jupiter/build') {
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`jupiter:${clientKey(req)}`, 1, 30, windowStart)) return json(res, 429, { error: 'Too many quotes; wait a moment.' });
      const input = await body(req);
      const side = input.side, mint = String(input.mint || ''), user = String(input.user || '');
      const slippageBps = Number(input.slippageBps);
      if (!['buy', 'sell'].includes(side) || !validMint(mint) || !validMint(user) || mint === WSOL) return json(res, 400, { error: 'A valid side, token and wallet are required.' });
      if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 1000) return json(res, 400, { error: 'Slippage must be between 0.1% and 10%.' });
      const amountText = String(input.amount || '');
      if (!/^\d+(\.\d+)?$/.test(amountText) || Number(amountText) <= 0) return json(res, 400, { error: 'Enter a positive amount.' });
      let decimals = (await free.jupPrices([mint]).catch(() => new Map())).get(mint)?.decimals;
      if (!Number.isInteger(decimals)) decimals = (await tokenCache.read([mint]).catch(() => new Map())).get(mint)?.decimals;
      if (!Number.isInteger(decimals)) decimals = await mintDecimals(mint);
      if (!Number.isInteger(decimals)) return json(res, 503, { error: 'Token decimals are unavailable. Try again shortly.' });
      const inputDecimals = side === 'buy' ? 9 : decimals;
      const [whole, fraction = ''] = amountText.split('.');
      if (fraction.length > inputDecimals) return json(res, 400, { error: `Use at most ${inputDecimals} decimal places.` });
      const amount = BigInt(whole) * 10n ** BigInt(inputDecimals) + BigInt((fraction + '0'.repeat(inputDecimals)).slice(0, inputDecimals) || '0');
      try {
        const quote = await free.jupQuote({ inputMint: side === 'buy' ? WSOL : mint, outputMint: side === 'buy' ? mint : WSOL, amount, slippageBps });
        if (!quote?.outAmount || quote.error) return json(res, 404, { error: 'No swap route was found for this token and amount.' });
        const instructions = await free.jupSwapInstructions({ quoteResponse: quote, userPublicKey: user });
        if (instructions?.error) return json(res, 502, { error: 'The swap route could not be prepared.' });
        const keys = (instructions.addressLookupTableAddresses || []).filter(validMint).slice(0, 8);
        const missing = keys.filter(key => !(altCache.get(key)?.expiresAt > Date.now()));
        if (missing.length) {
          const infos = await connection().getMultipleAccountsInfo(missing.map(key => new PublicKey(key)), 'confirmed');
          infos.forEach((info, index) => { if (info) altCache.set(missing[index], { expiresAt: Date.now() + 600_000,
            addresses: AddressLookupTableAccount.deserialize(info.data).addresses.map(key => key.toBase58()) }); });
        }
        if (keys.some(key => !altCache.get(key))) return json(res, 503, { error: 'Swap lookup tables are unavailable. Try again.' });
        const latest = await connection().getLatestBlockhash('confirmed');
        return json(res, 200, { cluster: solanaCluster, side, mint, user, decimals, amount: amount.toString(), slippageBps,
          quote: { inAmount: quote.inAmount, outAmount: quote.outAmount, otherAmountThreshold: quote.otherAmountThreshold, priceImpactPct: quote.priceImpactPct,
            routes: (quote.routePlan || []).map(step => step?.swapInfo?.label).filter(Boolean).slice(0, 6) },
          instructions: { computeBudgetInstructions: instructions.computeBudgetInstructions || [], setupInstructions: instructions.setupInstructions || [],
            swapInstruction: instructions.swapInstruction, cleanupInstruction: instructions.cleanupInstruction || null, otherInstructions: instructions.otherInstructions || [] },
          lookupTables: keys.map(key => ({ key, addresses: altCache.get(key).addresses })), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
      } catch { return json(res, 503, { error: 'Swap routing is temporarily unavailable. Try again shortly.' }); }
    }
    return false;
  };
}
export { dexMarketActivity };
