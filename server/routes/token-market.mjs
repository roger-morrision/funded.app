import {createSolUsdQuoteReader} from '../price-quote.mjs';
import {recordTop100Snapshot} from '../top100-growth.mjs';
import {createHolderRewardQuoteReader} from '../holder-reward-quote.mjs';
import {requireSolanaCluster,assertRpcNetwork} from '../../solana-network.js';
import { PublicKey, Connection } from '@solana/web3.js';
import { normalizeLargestTokenAccounts, attachVerifiedTokenAccountWallets, normalizeAllTokenAccounts } from '../token-accounts.mjs';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { readPumpMarketActivity } from '../coin-market.mjs';
import { readWalletTradeHistory } from '../wallet-trades.mjs';
import { createExternalTokenMarketReader } from '../external-token-market.mjs';
import { createOffchainMetadataReader } from '../token-offchain-metadata.mjs';
import { readVerifiedListingMint } from '../token-metadata.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createTokenMarketRoutes({
  route, store, clientKey, solanaRpcUrl, solanaCluster,
  respond, readMarketActivity = readPumpMarketActivity, env=process.env,
  readWalletTrades = readWalletTradeHistory,
  readRankingQuote = null,
  readMarketFallback = async () => null,
  makeMarketConnection = null,
  makeTokenConnection = endpoint => new Connection(endpoint, 'confirmed'),
  readExternalMarket = createExternalTokenMarketReader({ solanaCluster }),
  readMintMetadata = readVerifiedListingMint,
  readOffchainMetadata = createOffchainMetadataReader(),
}) {
  requireSolanaCluster(solanaCluster);
  const readRankingSolUsd = createSolUsdQuoteReader();
  const coinMarketCache = new Map();
  const tokenMetadataCache = new Map();
  const tokenAccountsCache = new Map();
  const tokenAccountsInflight = new Map();
  const coinMarketInflight = new Map();
  let coinMarketActive = 0;
  const coinMarketWaiting = [];
  const walletTradeCache=new Map(),walletTradeInflight=new Map();
  const maxActiveMarketScans = 4;
  const maxWaitingMarketScans = 24;
  const json = (...args) => { respond(...args); return true; };
  // Explore cards only had stats for coins a visitor opened in the last five
  // minutes. The discovery feed calls this with its uncovered mints; it starts
  // at most WARM_BATCH scans, only when no visitor scan is running, under its
  // own per-minute RPC budget (the "server-warmer" client key).
  const warmAttempts = new Map();
  const WARM_BATCH = 2, WARM_FRESH_MS = 4 * 60_000;
  const WARMER_REQUEST = { socket: { remoteAddress: 'server-warmer' }, headers: {} };
  function warmMarketActivity(mints) {
    if (coinMarketInflight.size > 0) return 0;
    let started = 0;
    for (const raw of [...(Array.isArray(mints) ? mints : [])].sort((a,b)=>(warmAttempts.get(a)||0)-(warmAttempts.get(b)||0))) {
      if (started >= WARM_BATCH) break;
      let mint;
      try { mint = new PublicKey(raw); } catch { continue; }
      const address = mint.toBase58(), cached = coinMarketCache.get(address);
      if (cached && Date.now() - cached.at < WARM_FRESH_MS) continue;
      if(warmAttempts.size>=500)warmAttempts.delete(warmAttempts.keys().next().value);
      warmAttempts.set(address,Date.now());
      startMarketScan(address, mint, WARMER_REQUEST)?.catch(() => {});
      started += 1;
    }
    return started;
  }
  handleTokenMarketRoutes.warmMarketActivity = warmMarketActivity;
  return handleTokenMarketRoutes;
  async function handleTokenMarketRoutes(req, res, url, requestId) {
    const walletMatch=req.method==='GET'?/^\/api\/wallets\/([^/]+)\/trades$/.exec(url.pathname):null;
    if (walletMatch) {
      let wallet;
      try {wallet=new PublicKey(decodeURIComponent(walletMatch[1])).toBase58();}
      catch {return json(res,400,{error:'A valid Solana wallet is required.'});}
      const cached=walletTradeCache.get(wallet);
      if (cached&&Date.now()-cached.at<60_000) return json(res,200,cached.data);
      let pending=walletTradeInflight.get(wallet);
      if (!pending) {
        if (walletTradeInflight.size>=2) return json(res,429,{error:'Wallet history scanning is busy; retry shortly.'});
        pending=(async()=>{
          if (!await store.chargeRpcRate(`wallet-trades:${clientKey(req)}`,10,60,Math.floor(Date.now()/60_000)*60_000))
            return {status:429,data:{error:'Wallet history refresh limit reached; retry shortly.'}};
          const signal=AbortSignal.timeout(20_000);
          const connection=new Connection(solanaRpcUrl,{commitment:'finalized',disableRetryOnRateLimit:true,
            fetch:(input,init)=>fetch(input,{...init,signal})});
          const data=await readWalletTrades({connection,wallet,cluster:solanaCluster});
          if (walletTradeCache.size>=250) walletTradeCache.delete(walletTradeCache.keys().next().value);
          walletTradeCache.set(wallet,{at:Date.now(),data});
          return {status:200,data};
        })().finally(()=>walletTradeInflight.delete(wallet));
        walletTradeInflight.set(wallet,pending);
      }
      try {const result=await pending;return json(res,result.status,result.data);}
      catch {return json(res,502,{error:'Finalized wallet trade history is unavailable.'});}
    }
    const metadataMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/metadata$/) : null;
    if (metadataMint) {
      let address;
      try { address = new PublicKey(decodeURIComponent(metadataMint)).toBase58(); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const cached = tokenMetadataCache.get(address);
      if (cached && Date.now() - cached.at < 5 * 60_000) return json(res, 200, cached.data);
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`token-metadata:${clientKey(req)}`, 2, 30, windowStart)) return json(res, 429, { error: 'Metadata refresh limit reached; retry shortly.' });
      let onchain;
      try { onchain = await readMintMetadata(makeTokenConnection(solanaRpcUrl), address); }
      catch (error) { return json(res, /not found|not a supported|not initialized/i.test(String(error?.message)) ? 404 : 502, { error: /not found|not a supported|not initialized/i.test(String(error?.message)) ? error.message : 'Token metadata is unavailable right now.' }); }
      const offchain = await readOffchainMetadata(onchain.uri);
      const data = { mint: address, cluster: solanaCluster, name: onchain.metadataStatus === 'missing' ? offchain.metadata?.name || null : onchain.name,
        symbol: onchain.metadataStatus === 'missing' ? offchain.metadata?.symbol || null : onchain.symbol,
        metadataStatus: onchain.metadataStatus, source: onchain.source, tokenProgram: onchain.tokenProgram, decimals: onchain.decimals,
        uri: onchain.uri || null, offchainStatus: offchain.status,
        image: offchain.metadata?.image || null, description: offchain.metadata?.description || null,
        links: { website: offchain.metadata?.website || null, twitter: offchain.metadata?.twitter || null, telegram: offchain.metadata?.telegram || null, discord: offchain.metadata?.discord || null },
        observedAt: new Date().toISOString() };
      if (tokenMetadataCache.size >= 500) tokenMetadataCache.delete(tokenMetadataCache.keys().next().value);
      tokenMetadataCache.set(address, { at: Date.now(), data });
      return json(res, 200, data);
    }
    const externalMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/external-market$/) : null;
    if (externalMint) {
      let address;
      try { address = new PublicKey(decodeURIComponent(externalMint)).toBase58(); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const windowStart = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`external-market:${clientKey(req)}`, 2, 30, windowStart)) return json(res, 429, { error: 'Market refresh limit reached; retry shortly.' });
      try { return json(res, 200, await readExternalMarket(address)); }
      catch { return json(res, 502, { error: 'DEX market data is unavailable right now.' }); }
    }
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
      if (!tokenAccountsInflight.has(address)) {
        const pending = (async () => {
        const connection = makeTokenConnection(solanaRpcUrl);
        if(solanaCluster==='mainnet-beta')await assertRpcNetwork(connection,solanaCluster);
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
        if (data.coverage === 'complete-account-list' && data.accounts.every(row => row.wallet)) {
          const wallets = new Set(data.accounts.filter(row => PublicKey.isOnCurve(new PublicKey(row.wallet).toBytes())).map(row => row.wallet));
          await recordTop100Snapshot(store,solanaCluster,address,'holders',wallets.size,Date.parse(data.observedAt)).catch(() => {});
        }
        return data;
        })().finally(() => { if(tokenAccountsInflight.get(address) === pending) tokenAccountsInflight.delete(address); });
        tokenAccountsInflight.set(address, pending);
      }
      try { return json(res, 200, await tokenAccountsInflight.get(address)); }
      catch { return json(res, 502, { error: 'Token-account provider is unavailable.' }); }
    }
    const tokenMarketMint = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/market-activity$/) : null;
    if (tokenMarketMint) {
      let mint;
      try { mint = new PublicKey(decodeURIComponent(tokenMarketMint)); }
      catch { return json(res, 400, { error: 'A valid Solana mint is required.' }); }
      const address = mint.toBase58();
      const hasTradeBreakdown = data => data?.cluster===solanaCluster && (data.source==='birdeye' || (Object.hasOwn(data, 'poolHistoryCoverage') && Object.hasOwn(data, 'observedCoverage') && (data.tradeCount24h == null || (data.activityWindows?.['1h']
        && data.activityWindows?.['6h'] && data.activityWindows?.['24h']
        && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h)))));
      // A scan costs up to ~50 RPC reads. Results under a minute old are
      // current; results up to five minutes old (the client's activity window)
      // are served at once while a background scan replaces them.
      const fresh = entry => entry && Date.now() - entry.at < (entry.data.coverage==='unavailable'?5_000:60_000) && hasTradeBreakdown(entry.data);
      const usable = entry => entry && entry.data.source!=='birdeye' && entry.data.coverage!=='unavailable' && Date.now() - entry.at < 5 * 60_000 && hasTradeBreakdown(entry.data);
      let cached = coinMarketCache.get(address);
      if (fresh(cached)) return json(res, 200, cached.data);
      if (!usable(cached)) {
        const persisted = await store.readMarketActivity(address, solanaCluster);
        const entry = persisted ? { at: Date.parse(persisted.observedAt), data: persisted } : null;
        // A concurrent scan may have completed while the persisted read was pending.
        const refreshed = coinMarketCache.get(address);
        cached = fresh(refreshed) ? refreshed : usable(entry) ? entry : refreshed;
        if (cached === entry) coinMarketCache.set(address, entry);
        if (fresh(cached)) return json(res, 200, cached.data);
      }
      if (usable(cached)) {
        startMarketScan(address, mint, req)?.catch(() => {});
        return json(res, 200, cached.data);
      }
      const pending = startMarketScan(address, mint, req);
      if (!pending) return json(res, 429, { error:'Market activity refresh is busy; retry shortly.' });
      try { const result = await pending; return json(res, result.status, result.data); }
      catch { return json(res, 502, { error: 'Market activity provider is unavailable.' }); }
    }
    return false;
  }

  function startMarketScan(address, mint, req) {
    let pending = coinMarketInflight.get(address);
    if (!pending) {
      if (coinMarketInflight.size >= maxActiveMarketScans + maxWaitingMarketScans) return null;
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
              const signal = AbortSignal.timeout(18_000);
              const connection = makeMarketConnection ? makeMarketConnection(solanaRpcUrl) : new Connection(solanaRpcUrl, {commitment:'confirmed', disableRetryOnRateLimit:true,
                fetch:(input,init)=>fetch(input,{...init,signal})});
              let metrics;
              try {
                await assertRpcNetwork(connection,solanaCluster);
                metrics = await readMarketActivity({ connection, mint,
                  ...(address===env.FUNDED_TOKEN_MINT&&env.FUNDED_SWAP_POOL?{poolAddress:env.FUNDED_SWAP_POOL}:{}) });
                if (metrics.coverage === 'unavailable') metrics = await readMarketFallback(address) || metrics;
              } catch (error) {
                metrics = await readMarketFallback(address);
                if (!metrics) throw error;
              }
              if (metrics.source === 'birdeye') {
                // Keep indexed summaries out of confirmed-event storage and ranking snapshots.
                if (coinMarketCache.size >= 500) coinMarketCache.delete(coinMarketCache.keys().next().value);
                coinMarketCache.set(address,{at:Date.now(),data:metrics});
                return metrics;
              }
              // A failed scan must not erase a still-recent successful snapshot.
              const previous = coinMarketCache.get(address);
              if (metrics.coverage === 'unavailable' && previous?.data.volume24hSol != null
                && Date.now()-previous.at < 5*60_000) return previous.data;
              const result = { mint: address, cluster: solanaCluster, source: 'confirmed-pump-trade-events', observedAt: new Date().toISOString(), ...metrics };
              await store.writeMarketActivity(address, solanaCluster, result);
              // Reuse the bounded scan queue; no browser-supplied ranking values.
              try {
                const quote = await (readRankingQuote || createHolderRewardQuoteReader({connection,readSolUsd:readRankingSolUsd}))(address);
                await recordTop100Snapshot(store,solanaCluster,address,'marketCapUsd',quote?.marketCapUsd,Date.parse(quote?.observedAt));
              } catch { /* Keep growth unavailable when a verified valuation cannot be read. */ }
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
    return pending;
  }
}
