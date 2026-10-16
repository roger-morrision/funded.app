import { PublicKey, Connection } from '@solana/web3.js';
import { normalizeLargestTokenAccounts, attachVerifiedTokenAccountWallets, normalizeAllTokenAccounts } from '../token-accounts.mjs';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { readPumpMarketActivity } from '../coin-market.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createTokenMarketRoutes({
  route, store, clientKey, solanaRpcUrl, solanaCluster,
  respond, readMarketActivity = readPumpMarketActivity,
}) {
  const coinMarketCache = new Map();
  const tokenAccountsCache = new Map();
  const coinMarketInflight = new Map();
  let coinMarketActive = 0;
  const coinMarketWaiting = [];
  const maxActiveMarketScans = 4;
  const maxWaitingMarketScans = 24;
  const json = (...args) => { respond(...args); return true; };
  return async function handleTokenMarketRoutes(req, res, url, requestId) {
    const tokenAccountsMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/token-accounts$/) : null;
    if (tokenAccountsMint) {
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenAccountsMint)); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const address = mint.toBase58();
      const cached = tokenAccountsCache.get(address);
      if (cached && Date.now() - cached.at < 60_000) return json(res, 200, cached.data);
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`token-accounts:${clientKey(req)}`, 2, 30, windowStart)) return json(res, 429, { error: 'Token-account refresh limit reached; retry shortly.' });
      try {
        const connection = new Connection(solanaRpcUrl, 'confirmed');
        const sample = normalizeLargestTokenAccounts(await connection.getTokenLargestAccounts(mint, 'confirmed'));
        const infos = sample.accounts.length
          ? await connection.getMultipleAccountsInfo(sample.accounts.map(account => new PublicKey(account.address)), 'confirmed').catch(() => [])
          : [];
        let verifiedSample = attachVerifiedTokenAccountWallets(sample, infos, mint);
        if (sample.coverage === 'lower-bound') {
          try {
            const mintInfo = await connection.getAccountInfo(mint, 'confirmed');
            if (mintInfo && (mintInfo.owner.equals(TOKEN_PROGRAM_ID) || mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) {
              const rows = await connection.getProgramAccounts(mintInfo.owner, {
                commitment: 'confirmed', filters: [{ memcmp: { offset: 0, bytes: address } }],
              });
              verifiedSample = normalizeAllTokenAccounts(rows, mint, mintInfo.owner);
            }
          } catch { /* Retain the bounded, owner-verified sample when full scanning is unavailable. */ }
        }
        const data = { mint: address, cluster: solanaCluster, observedAt: new Date().toISOString(), ...verifiedSample };
        if (tokenAccountsCache.size >= 500) tokenAccountsCache.delete(tokenAccountsCache.keys().next().value);
        tokenAccountsCache.set(address, { at: Date.now(), data });
        return json(res, 200, data);
      } catch { return json(res, 502, { error: 'Token-account provider is unavailable.' }); }
    }
    const tokenMarketMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/market-activity$/) : null;
    if (tokenMarketMint) {
      if (solanaCluster !== 'devnet') return json(res, 503, { error: 'Pump trade scanning is currently available for Solana only.' });
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenMarketMint)); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const address = mint.toBase58();
      const hasTradeBreakdown = data => data && Object.hasOwn(data, 'poolHistoryCoverage') && Object.hasOwn(data, 'observedCoverage') && (data.tradeCount24h == null || (data.activityWindows?.['1h']
        && data.activityWindows?.['6h'] && data.activityWindows?.['24h']
        && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h)));
      const cached = coinMarketCache.get(address);
      if (cached && Date.now() - cached.at < 60_000 && hasTradeBreakdown(cached.data)) return json(res, 200, cached.data);
      const persisted = await store.readMarketActivity(address, solanaCluster);
      if (persisted && Date.now() - Date.parse(persisted.observedAt) < 60_000 && hasTradeBreakdown(persisted)) {
        coinMarketCache.set(address, { at: Date.parse(persisted.observedAt), data: persisted });
        return json(res, 200, persisted);
      }
      // A concurrent scan may have completed while the persisted read was pending.
      const refreshed = coinMarketCache.get(address);
      if (refreshed && Date.now() - refreshed.at < 60_000 && hasTradeBreakdown(refreshed.data))
        return json(res, 200, refreshed.data);
      let pending = coinMarketInflight.get(address);
      if (!pending) {
        if (coinMarketInflight.size >= maxActiveMarketScans + maxWaitingMarketScans)
          return json(res, 429, { error:'Market activity refresh is busy; retry shortly.' });
        pending = (async () => {
          const busy = () => coinMarketActive >= maxActiveMarketScans
            && coinMarketWaiting.length >= maxWaitingMarketScans;
          if (busy()) return { status:429, data:{ error:'Market activity refresh is busy; retry shortly.' } };
          const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
          if (!await store.chargeRpcRate(`market:${clientKey(req)}`, 10, 60, windowStart))
            return { status:429, data:{ error:'Market activity refresh limit reached; retry shortly.' } };
          if (busy()) return { status:429, data:{ error:'Market activity refresh is busy; retry shortly.' } };
          const data = await new Promise((resolve, reject) => {
            const start = () => {
              coinMarketActive += 1;
              (async () => {
                const metrics = await readMarketActivity({ connection: new Connection(solanaRpcUrl, 'confirmed'), mint });
                const result = { mint: address, cluster: solanaCluster, source: 'confirmed-pump-trade-events', observedAt: new Date().toISOString(), ...metrics };
                await store.writeMarketActivity(address, solanaCluster, result);
                if (coinMarketCache.size >= 500) coinMarketCache.delete(coinMarketCache.keys().next().value);
                coinMarketCache.set(address, { at: Date.now(), data:result });
                return result;
              })().then(resolve, reject).finally(() => {
                coinMarketActive -= 1;
                coinMarketWaiting.shift()?.();
              });
            };
            if (coinMarketActive < maxActiveMarketScans) start();
            else coinMarketWaiting.push(start);
          });
          return { status:200, data };
        })().finally(() => { coinMarketInflight.delete(address); });
        coinMarketInflight.set(address, pending);
      }
      try { const result = await pending; return json(res, result.status, result.data); }
      catch { return json(res, 502, { error: 'Market activity provider is unavailable.' }); }
    }
    return false;
  };
}
