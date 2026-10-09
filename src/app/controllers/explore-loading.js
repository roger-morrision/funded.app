// Dependencies and mutable application state are read live through appState.
export function createExploreLoadingController(appState) {
  // app-source: 523
  async function loadOnchainExploreData(signal){
    if (appState.exploreLoadInFlight) return appState.exploreLoadInFlight;
    const requestedSort = appState.exploreSort;
    const load = appState.loadOnchainExploreDataOnce(signal, requestedSort);
    appState.exploreLoadInFlight = load;
    try { return await load; }
    finally {
      if (appState.exploreLoadInFlight === load) appState.exploreLoadInFlight = null;
      if (requestedSort !== appState.exploreSort && !signal?.aborted) void appState.loadOnchainExploreData(signal).catch(() => {});
    }
  }
  // app-source-end

  // app-source: 524
  async function loadOnchainExploreDataOnce(signal, requestedSort){
      const pumpSort = requestedSort === 'newest' ? 'created_timestamp' : 'last_trade_timestamp';
      const birdeyeSort = requestedSort === 'change' ? 'price_change_24h_percent' : requestedSort === 'market-cap' ? 'market_cap' : 'volume_24h_usd';
      const feeds = [
        Promise.resolve({ available: false, data: null }),
        appState.apiRequest(`/api/pump/explore?limit=40&sort=${encodeURIComponent(pumpSort)}`, { signal }).catch(() => ({ available: false, data: null })),
      ];
      if (appState.EXPLORE_CLUSTER !== 'devnet') feeds[0] = appState.apiRequest(`/api/birdeye/explore?limit=40&sort_by=${encodeURIComponent(birdeyeSort)}`, { signal }).catch(() => ({ available: false, data: null }));
      const [birdeyeFeed, pumpFeed] = await Promise.all(feeds);
      signal?.throwIfAborted();
      if (appState.EXPLORE_CLUSTER === 'devnet' && appState.verifiedLaunchPoliciesStatus !== 'ready') await appState.loadVerifiedLaunchPolicies(signal);
      appState.exploreFeedAvailable = pumpFeed.available;
      if (pumpFeed.available) appState.exploreFeedSort = pumpSort;
      const birdeyeRecords = Array.isArray(birdeyeFeed.data?.items) ? birdeyeFeed.data.items : [];
      const pumpRecords = Array.isArray(pumpFeed.data?.items) ? pumpFeed.data.items : [];
      const birdeyeByAddress = new Map(birdeyeRecords.map(item => [item.address, item]));
      const records = pumpRecords.map(pump => {
        const market = birdeyeByAddress.get(pump.mint);
        return {
          ...pump,
          address: pump.mint,
          priceUsd: market?.priceUsd ?? null,
          priceChange24hPercent: market?.priceChange24hPercent ?? null,
          marketCapUsd: market?.marketCapUsd ?? pump.marketCapUsd,
          liquidityUsd: market?.liquidityUsd ?? null,
          volume24hUsd: market?.volume24hUsd ?? null,
          holders: market?.holders ?? null,
          lastTradeUnixTime: market?.lastTradeUnixTime ?? pump.lastTradeTimestamp ?? null,
          source: appState.verifiedPaidListingPayment(pump) ? 'Paid listing · mint verified' : market ? 'Pump.fun + Birdeye' : appState.EXPLORE_CLUSTER === 'devnet' ? 'Verified Solana registry' : 'Pump.fun',
          fetchedAt: market ? birdeyeFeed.data?.fetchedAt : pumpFeed.data?.fetchedAt,
        };
      });
      const verified = [];
      let exploreVerificationFailed = false;
      let exploreRateLimited = false;
      if (records.length) {
        try {
          const { PublicKey, getAssociatedTokenAddressSync, unpackAccount, unpackMint, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await appState.getSolana();
          const exploreRpc = await appState.getExploreConnection();
          const candidates = records.flatMap(record => { try { return [{ record, mint: new PublicKey(record.address) }]; } catch { return []; } });
          const accountBatch = candidates.length ? await exploreRpc.getMultipleAccountsInfo([...candidates.map(item => item.mint), ...candidates.map(item => appState.bondingCurvePda(item.mint))], 'confirmed') : [];
          const accounts = accountBatch.slice(0, candidates.length);
          const curveAccounts = accountBatch.slice(candidates.length);
          for (let index = 0; index < candidates.length; index += 1) {
            const { record, mint } = candidates[index];
            try {
              const mintAccount = accounts[index];
              if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) continue;
              const mintState = unpackMint(mint, mintAccount, mintAccount.owner);
              const curveAccount = curveAccounts[index];
              const curve = curveAccount?.owner?.equals(appState.PUMP_PROGRAM_ID) ? appState.PUMP_SDK.decodeBondingCurveNullable(curveAccount) : null;
              const curveMetrics = appState.readCurveMetrics(curve, mintState);
              const numeric = value => value == null || value === '' ? NaN : Number(value);
              const price = numeric(record.priceUsd);
              const change = numeric(record.priceChange24hPercent);
              const marketCap = numeric(record.marketCapUsd);
              const curveTokenVault = curve ? getAssociatedTokenAddressSync(mint, appState.bondingCurvePda(mint), true, mintAccount.owner).toBase58() : null;
              verified.push({ mint: record.address, symbol: record.symbol || 'TOKEN', name: record.name || 'Unnamed token', value: appState.EXPLORE_CLUSTER === 'devnet' && curveMetrics.curvePriceSol != null ? `MC · ${appState.formatCoinUsd(curveMetrics.curveCapSol)}` : Number.isFinite(marketCap) ? `MC · ${appState.formatUsd(marketCap)}` : 'MC unavailable', change: Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—', meta: Number.isFinite(marketCap) ? `MC ${appState.formatCompactUsd(marketCap)} · ${record.source || 'Pump.fun'}` : (record.source || 'Pump.fun'), icon: String(record.symbol || 'T').slice(0, 1), source: record.source || 'Pump.fun', listingPayment: record.listingPayment || null, creator: record.creator || null, website: record.website || null, twitter: record.twitter || record.x || null, telegram: record.telegram || null, discord: record.discord || null, complete: curve ? Boolean(curve.complete) : null, migrated: null, pumpSwapPool: null, quoteMint: curve?.quoteMint?.toBase58?.() || null, bondingCurve: curve ? appState.bondingCurvePda(mint).toBase58() : null, curveTokenVault, raydiumPool: record.raydiumPool || null, fetchedAt: record.fetchedAt || null, verifiedAt: new Date().toISOString(), address: record.address, mintSupplyRaw: mintState.supply.toString(), mintDecimals: mintState.decimals, mintAuthorityRevoked: mintState.mintAuthority == null, freezeAuthorityRevoked: mintState.freezeAuthority == null, volume24hUsd: record.volume24hUsd ?? null, liquidityUsd: record.liquidityUsd ?? null, holders: record.holders ?? null, marketCapUsd: Number.isFinite(marketCap) ? marketCap : null, priceChange24hPercent: Number.isFinite(change) ? change : null, createdTimestamp: record.createdTimestamp || null, lastTradeUnixTime: record.lastTradeUnixTime || null, ...curveMetrics });
           } catch {}
           }
           const completed = verified.filter(item => item.complete === true);
           if (completed.length) {
             try {
               const poolKeys = completed.map(item => appState.canonicalPumpPoolPda(new PublicKey(item.address), item.quoteMint ? new PublicKey(item.quoteMint) : undefined));
               const poolAccounts = await exploreRpc.getMultipleAccountsInfo(poolKeys, 'confirmed');
                const decodedPools = completed.map(() => null);
                completed.forEach((item, index) => {
                  const account = poolAccounts[index];
                  item.migrated = false;
                  if (!account?.owner?.equals(appState.PUMP_AMM_PROGRAM_ID)) return;
                  try {
                    const pool = appState.PUMP_AMM_SDK.decodePool(account);
                    if (!pool.baseMint?.equals(new PublicKey(item.address))) return;
                    item.migrated = true;
                    item.pumpSwapPool = poolKeys[index].toBase58();
                    decodedPools[index] = pool;
                  } catch {}
                });
                const migratedPools = decodedPools.flatMap((pool, index) => pool ? [{ pool, item: completed[index] }] : []);
                if (migratedPools.length) {
                  const vaultAccounts = await exploreRpc.getMultipleAccountsInfo(migratedPools.flatMap(({ pool }) => [pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount]), 'confirmed');
                  migratedPools.forEach(({ pool, item }, index) => {
                    if (!pool.quoteMint?.equals(NATIVE_MINT)) return;
                    try {
                      const baseInfo = vaultAccounts[index * 2];
                      const quoteInfo = vaultAccounts[index * 2 + 1];
                      const baseVault = unpackAccount(pool.poolBaseTokenAccount, baseInfo, baseInfo?.owner);
                      const quoteVault = unpackAccount(pool.poolQuoteTokenAccount, quoteInfo, quoteInfo?.owner);
                      const metrics = appState.readPumpSwapMetrics({ baseAmount: baseVault.amount, quoteAmount: quoteVault.amount, virtualQuoteAmount: pool.virtualQuoteReserves, baseDecimals: item.mintDecimals, quoteDecimals: 9, supply: item.mintSupplyRaw });
                      Object.assign(item, metrics, { pumpSwapBaseVault: pool.poolBaseTokenAccount.toBase58(), pumpSwapQuoteVault: pool.poolQuoteTokenAccount.toBase58() });
                      if (metrics.poolPriceSol != null) item.value = `MC · ${appState.formatCoinUsd(metrics.poolMarketCapSol)}`;
                    } catch {}
                  });
                }
             } catch { /* A failed pool lookup leaves migration unverified. */ }
           }
        } catch (error) { exploreVerificationFailed = true; exploreRateLimited = /429|rate.?limit|too many requests/i.test(String(error?.message || '')); }
      }
      signal?.throwIfAborted();
      if (requestedSort !== appState.exploreSort) return;
      if (exploreRateLimited) appState.exploreBackoffUntil = Date.now() + 60_000;
      else if (!exploreVerificationFailed) appState.exploreBackoffUntil = 0;
      if ((exploreVerificationFailed || !pumpFeed.available) && appState.assets.length && appState.exploreLastVerifiedAt) {
        appState.publishVerifiedCurves([]);
        appState.publishTokenListMarkets([], appState.EXPLORE_CLUSTER, appState.coinSolUsdPrice);
        appState.exploreUpdatedAt = new Date().toISOString();
        const cause = exploreVerificationFailed ? `Solana RPC ${exploreRateLimited ? 'rate limited' : 'unavailable'}` : 'Launch feed unavailable';
        appState.exploreProviderStatus = `${cause} · last verified ${appState.formatFeedAge(appState.exploreLastVerifiedAt)} · stale`;
        appState.renderExploreAssets();
        appState.renderRegistry();
        return;
      }
      let scannedCount = 0;
      let marketScanRateLimited = false;
      if (appState.EXPLORE_CLUSTER === 'devnet' && !exploreVerificationFailed) {
        // The endpoint's 60-credit minute budget charges ten credits per fresh scan.
        // Leave one scan available for an explicit token-detail request.
        const scanned = verified.slice(0, 5);
        await Promise.all(scanned.map(async item => {
          const cached = appState.exploreActivityCache.get(item.address);
          const hasBreakdown = data => data && Object.hasOwn(data, 'observedCoverage') && (data.tradeCount24h == null || (data.activityWindows?.['1h']
            && data.activityWindows?.['6h'] && data.activityWindows?.['24h']
            && Number.isInteger(data.buyCount24h) && Number.isInteger(data.sellCount24h)));
          let market = cached && Date.now() - cached.at < 60_000 && hasBreakdown(cached.data) ? cached.data : null;
          if (!market) {
            const response = await appState.apiRequest(`/api/tokens/${encodeURIComponent(item.address)}/market-activity`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }).catch(error => {
              if (/rate limit|429|too many requests/i.test(String(error?.message || ''))) marketScanRateLimited = true;
              return { available: false, data: null };
            });
            if (response.available && response.data?.cluster === appState.EXPLORE_CLUSTER && response.data?.mint === item.address) {
              market = response.data;
              appState.exploreActivityCache.set(item.address, { at: Date.now(), data: market });
            }
          }
          if (!market) return;
          scannedCount += 1;
          const volume = Number(market.volume24hSol);
          item.volume24hSol = market.volume24hSol != null && Number.isFinite(volume) && volume >= 0 ? volume : null;
          item.volumeCoverage = market.coverage;
          const observedVolume = Number(market.observedVolumeSol);
          item.observedVolumeSol = market.observedVolumeSol != null && Number.isFinite(observedVolume) && observedVolume >= 0 ? observedVolume : null;
          item.observedCoverage = market.observedCoverage || 'unavailable';
          for (const key of ['tradeCount24h', 'buyCount24h', 'sellCount24h']) {
            const count = Number(market[key]);
            item[key] = market[key] != null && Number.isInteger(count) && count >= 0 ? count : null;
          }
          const traderCountRaw = market.activityWindows?.['24h']?.traderCount;
          const traderCount = Number(traderCountRaw);
          item.traderCount24h = traderCountRaw != null && Number.isInteger(traderCount) && traderCount >= 0 ? traderCount : null;
          item.recentTrades = Array.isArray(market.recentTrades) ? market.recentTrades : [];
          item.activityWindows = market.activityWindows && ['1h', '6h', '24h'].every(period => market.activityWindows[period]) ? market.activityWindows : null;
          const latestTrade = Number(market.recentTrades?.[0]?.blockTime);
          if (Number.isFinite(latestTrade) && latestTrade > 0) item.lastTradeUnixTime = latestTrade;
          if (market.priceChangeBasis === '24h' && market.priceChangePercent != null && Number.isFinite(Number(market.priceChangePercent))) {
            item.priceChange24hPercent = Number(market.priceChangePercent);
            item.change = `${item.priceChange24hPercent >= 0 ? '+' : ''}${item.priceChange24hPercent.toFixed(2)}%`;
          }
        }));
      }
      signal?.throwIfAborted();
      if (requestedSort !== appState.exploreSort) return;
      appState.exploreScannedCount = scannedCount;
      if (marketScanRateLimited) appState.exploreBackoffUntil = Date.now() + 60_000;
    appState.assets = appState.includeVerifiedRegistryLaunches(Array.from(new Map(verified.map(item => [item.address, item])).values()), records);
      appState.publishVerifiedCurves(appState.assets);
      appState.publishTokenListMarkets(appState.assets, appState.EXPLORE_CLUSTER, appState.coinSolUsdPrice);
      document.dispatchEvent(new Event('funded:verified-search-index'));
      appState.exploreUpdatedAt = new Date().toISOString();
      if (!exploreVerificationFailed && pumpFeed.available && records.length) appState.exploreLastVerifiedAt = appState.exploreUpdatedAt;
      appState.exploreProviderStatus = appState.EXPLORE_CLUSTER === 'devnet' && appState.assets.length && verified.length < appState.assets.length
        ? `Verified launch registry · ${verified.length ? `${verified.length}/${appState.assets.length} live mint checks` : 'live mint checks unavailable'}`
        : exploreVerificationFailed ? `Solana RPC ${exploreRateLimited ? 'rate limited · retry shortly' : 'unavailable'}` : !pumpFeed.available ? 'Launch feed unavailable' : !records.length ? 'No indexed launches · awaiting RPC verification' : !verified.length ? 'Indexed launches · none passed RPC verification' : appState.EXPLORE_CLUSTER === 'devnet' ? `Solana registry · RPC verified${marketScanRateLimited ? ' · trade history rate limited' : ''}` : !birdeyeFeed.available ? `Pump.fun · Birdeye unavailable · RPC verified` : 'Pump.fun + Birdeye · RPC verified';
      const feedStatus = document.querySelector('#explore-data-status');
      appState.renderExploreAssets();
      appState.renderHomeLaunchBoard();
      appState.renderCreatorLaunches();
      appState.renderPortfolio();
      void appState.loadHomeHolderCounts(appState.assets);
      void appState.loadHomeFeeIndex();
      if (feedStatus) {
        feedStatus.textContent = appState.exploreProviderStatus;
      }
      appState.renderRegistry();
      appState.updateExploreSortAvailability();
    appState.renderOnchainReportState(verified);
    appState.renderLeaderboard();
    appState.renderHomeOnchainSnapshot(verified);
  }
  // app-source-end

  return { loadOnchainExploreData, loadOnchainExploreDataOnce };
}
