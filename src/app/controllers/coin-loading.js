import { verifiedTokenBannerUri } from '../../features/coin/token-banner.js';

// Dependencies and mutable application state are read live through appState.
export function createCoinLoadingController(appState) {
  // app-source: 981
  async function loadCoinOnChain(mintAddress){
    const loadId = ++appState.coinLoadId;
    if (!mintAddress){ appState.renderOnChainUnavailable('Choose a token from Explore to see its details.'); return; }
    void appState.loadCoinChat(mintAddress, loadId);
    appState.setCoinField('#coin-page-title', 'Loading token…'); appState.setCoinField('#coin-symbol', 'TOKEN'); appState.setCoinField('#coin-address', appState.shortAddress(mintAddress));
    appState.setCoinField('#coin-description', 'Checking coin details on Solana…');
    try {
      const { PublicKey, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await appState.getSolana();
      const detailConnection = await appState.getExploreConnection();
      const mint = new PublicKey(mintAddress);
      const metadataProgram = new PublicKey(appState.TOKEN_METADATA_PROGRAM_ID);
      const [metadataPda] = PublicKey.findProgramAddressSync([appState.Buffer.from('metadata'), metadataProgram.toBuffer(), mint.toBuffer()], metadataProgram);
      const rpcRequest = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 12000))]);
      const [mintResult, metadataResult, curveResult, largestResult, launchesResult] = await Promise.allSettled([
        rpcRequest(detailConnection.getParsedAccountInfo(mint, 'confirmed'), 'Mint RPC request'),
        rpcRequest(detailConnection.getAccountInfo(metadataPda, 'confirmed'), 'Metadata RPC request'),
        rpcRequest(appState.fetchBondingCurveSnapshot({ connection: detailConnection, mint }), 'Pump curve RPC request'),
        rpcRequest(appState.fetchTokenAccountSample(mintAddress, detailConnection, PublicKey), 'Token-account RPC request'),
        appState.apiRequest('/api/launches', { signal: AbortSignal.timeout(5000) }),
      ]);
      if (loadId !== appState.coinLoadId) return;
      if (mintResult.status === 'rejected') throw mintResult.reason;
      const mintInfo = mintResult.value;
      const metadataInfo = metadataResult.status === 'fulfilled' ? metadataResult.value : null;
      const curve = curveResult.status === 'fulfilled' ? curveResult.value : null;
      const largestAccounts = largestResult.status === 'fulfilled' ? largestResult.value.accounts : [];
      const parsedMint = mintInfo.value?.data?.parsed?.info;
      if (!parsedMint) throw new Error('Mint account was not returned by Solana RPC.');
      const decimals = Number(parsedMint.decimals ?? 0);
      const supply = Number(parsedMint.supply) / (10 ** decimals);
      let graduatedPool = null;
      if (curve?.complete) {
        try { graduatedPool = await rpcRequest(appState.fetchGraduatedPoolSnapshot({ connection: detailConnection, mint, tokenDecimals: decimals }), 'PumpSwap pool RPC request'); }
        catch (error) { console.warn('Graduated PumpSwap pool snapshot unavailable', error); }
      }
      if (loadId !== appState.coinLoadId) return;
      const metadata = appState.parseOnChainMetadata(metadataInfo?.data);
      const registeredLaunch = launchesResult.status === 'fulfilled' && launchesResult.value.available
        ? appState.verifiedRegistryLaunch(launchesResult.value.data, mintAddress, appState.EXPLORE_CLUSTER)
        : null;
      appState.coinSummaryLaunch = registeredLaunch;
      const promotedBanner = verifiedTokenBannerUri(registeredLaunch, mintAddress);
      const artwork = document.querySelector('.coin-artwork');
      if (artwork) artwork.dataset.bannerUrl = promotedBanner;
      appState.renderCoinRewardsPolicy(registeredLaunch, mintAddress);
      const symbol = metadata.symbol || registeredLaunch?.symbol || `${mintAddress.slice(0, 4)}…`;
      const name = metadata.name || registeredLaunch?.name || 'Unnamed on-chain token';
      appState.coinTradeEstimate = { mint: mintAddress, symbol, curve, graduatedPool, decimals };
      appState.updateTradeAmountLabel();
      void appState.refreshTradeBalances();
      appState.renderTradeAmountEstimate();
      const spotPriceSol = graduatedPool?.spotPriceSol ?? (curve && curve.virtualTokenReserves > 0 ? curve.virtualQuoteReservesSol / curve.virtualTokenReserves : NaN);
      const marketCapSol = spotPriceSol * supply;
      const accountAvailable = largestResult.status === 'fulfilled';
      const rawSupply = Number(parsedMint.supply);
      const tokenProgram = mintInfo.value.owner;
      const verifiedTokenProgram = tokenProgram?.equals?.(TOKEN_PROGRAM_ID) || tokenProgram?.equals?.(TOKEN_2022_PROGRAM_ID);
      const curveVaultAddress = graduatedPool?.poolBaseTokenAccount || (curve && verifiedTokenProgram
        ? getAssociatedTokenAddressSync(mint, appState.bondingCurvePda(mint), true, tokenProgram).toBase58() : null);
      const accounts = largestAccounts.filter(item => Number(item.amount) > 0).map(item => {
        const balance = Number(item.uiAmountString == null || item.uiAmountString === '' ? Number(item.amount) / (10 ** decimals) : item.uiAmountString);
        return { address: String(item.address), wallet: item.wallet || null, balance, amount: appState.formatOnChainNumber(balance, 4), share: rawSupply > 0 ? Number(item.amount) / rawSupply * 100 : null };
      });
      const tokenAccounts = accounts.length;
      const distribution = accountAvailable ? appState.summarizeTokenAccounts(accounts, curveVaultAddress) : null;
      const fullHolderDistribution = accountAvailable
        ? appState.summarizeFullHolderDistribution(largestAccounts, curveVaultAddress, parsedMint.supply) : null;
      const realQuote = graduatedPool?.quoteReservesSol ?? curve?.realQuoteReservesSol;
      const ledger = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/fee-activity`, { signal: AbortSignal.timeout(8000) }).catch(() => ({ available: false, data: null }));
      if (loadId !== appState.coinLoadId) return;
      const ledgerAvailable = ledger.available && ledger.data?.cluster === appState.EXPLORE_CLUSTER;
      const linkedRouter = ledgerAvailable && curve?.creator === ledger.data?.sharedRouter?.address;
      appState.coinActivity = { status: 'ready', symbol, accounts, accountAvailable, holderDistribution: fullHolderDistribution, holderCount: fullHolderDistribution?.walletCount ?? 0, holderCountPartial: false, tokenDecimals: decimals, vaultAddress: curveVaultAddress || null, vaultLabel: graduatedPool ? 'PumpSwap pool vault' : 'Pump curve vault', ledgerAvailable, ledgerSource: ledger.data?.source === 'funded.app-postgresql' ? 'app database' : 'file ledger', collections: ledgerAvailable ? ledger.data.collections || [] : [], claims: ledgerAvailable ? ledger.data.claims || [] : [], sharedRouterCollections: linkedRouter ? ledger.data.sharedRouter.collections || [] : [] };
      appState.coinSummaryLedgerMint = ledgerAvailable && ledger.data?.mint === mintAddress ? mintAddress : null;
      appState.renderCoinFeeDashboard(appState.coinSummaryLedgerMint ? ledger.data?.overview : { available:false });
      appState.renderCoinAccountDistribution(fullHolderDistribution, decimals, symbol, graduatedPool ? 'PumpSwap pool vault' : 'Curve vault');
      appState.setCoinTabLabels(); appState.renderCoinActivityTab();
      appState.setCoinField('.coin-live-dot', graduatedPool ? 'Trading pool confirmed' : curve ? 'Trading route confirmed' : 'Token confirmed');
      appState.setCoinField('#coin-avatar', symbol.slice(0, 1).toUpperCase()); appState.setCoinField('#coin-symbol', symbol); appState.setCoinField('#coin-artwork-symbol', symbol); appState.setCoinField('#coin-page-title', name);
      appState.setCoinField('#coin-address', appState.shortAddress(mintAddress)); appState.setCoinField('#coin-full-address', mintAddress);
      appState.setCoinField('#coin-description', graduatedPool ? 'Trading pool confirmed. Checking recent trades…' : 'Coin details confirmed on Solana. Checking recent trades…');
      appState.setCoinFact('#coin-stage', graduatedPool ? 'Migrated · PumpSwap' : curve ? curve.complete ? 'Curve complete · pool unavailable' : 'On Pump curve' : 'Unverified', curve ? 'clear' : 'unknown');
      appState.setCoinFact('#coin-fee-owner', linkedRouter ? 'App router address matched' : curve?.creator ? appState.shortAddress(curve.creator) : 'Unavailable', linkedRouter ? 'clear' : 'unknown');
      appState.setCoinFact('#coin-metadata-status', metadataInfo?.data && (metadata.name || metadata.symbol) ? 'On-chain name / symbol' : registeredLaunch ? 'Pump create event verified' : 'No verified name', metadataInfo?.data && (metadata.name || metadata.symbol) || registeredLaunch ? 'clear' : 'unknown');
      appState.coinSolUsdValues = { spot: spotPriceSol, marketCap: marketCapSol, reserve: realQuote, virtualQuote: curve?.virtualQuoteReservesSol ?? NaN, supply };
      appState.renderCoinSummary();
      appState.setCoinField('#coin-market-cap', appState.formatCoinUsd(marketCapSol)); appState.setCoinField('#coin-change', '24h change unavailable');
      appState.setCoinField('#coin-strip-market-cap', appState.formatCoinUsd(marketCapSol));
      appState.setCoinField('#coin-volume', curve && appState.EXPLORE_CLUSTER === 'devnet' ? 'Reading trades…' : '$—'); appState.setCoinField('#coin-liquidity', appState.formatCoinUsd(realQuote));
      appState.setCoinField('#coin-market-cap-label', graduatedPool ? 'Estimated PumpSwap market cap' : 'Estimated curve market cap');
      appState.setCoinField('#coin-market-cap-source', graduatedPool ? 'PumpSwap vault ratio · indicative RPC snapshot' : 'Confirmed Pump curve RPC snapshot');
      appState.setCoinField('#coin-liquidity-label', graduatedPool ? 'Pool reserve' : 'Real reserve');
      appState.setCoinField('#coin-holders', fullHolderDistribution ? `${appState.formatOnChainNumber(fullHolderDistribution.holderShare, 2)}%` : 'Unavailable');
      appState.setCoinField('#coin-holder-count', fullHolderDistribution ? `${fullHolderDistribution.walletCount}` : 'Unavailable');
      appState.setCoinField('#coin-accounts-source', fullHolderDistribution ? `${fullHolderDistribution.accountCount} non-zero token accounts · full minted supply reconciled` : distribution ? `${distribution.otherCount} non-vault token accounts in top ${tokenAccounts} · partial sample` : `${graduatedPool ? 'Pool' : 'Curve'} vault not identified in largest-account sample`);
      appState.setCoinField('#coin-vault-share', distribution ? `${appState.formatOnChainNumber(distribution.vaultShare, 2)}% of supply` : curveVaultAddress && accountAvailable ? 'Outside top sample' : 'Unavailable');
      appState.setCoinField('#coin-largest-account-share', distribution ? distribution.otherCount ? `${appState.formatOnChainNumber(distribution.largestOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
      appState.setCoinField('#coin-top-ten-share', distribution ? distribution.otherCount ? `${appState.formatOnChainNumber(distribution.topTenOtherShare, 2)}% of supply` : 'None in sample' : 'Unavailable');
      appState.setCoinAuthority('#coin-mint-authority', parsedMint.mintAuthority); appState.setCoinAuthority('#coin-freeze-authority', parsedMint.freezeAuthority);
      appState.setCoinField('#coin-supply', `${appState.formatOnChainNumber(supply, 6)} ${symbol}`); appState.setCoinCurveProgress(curve?.complete ? 100 : curve?.progressPercent);
      const curveProgress = document.querySelector('.coin-curve-track > span'); if (curveProgress) curveProgress.textContent = graduatedPool ? 'Migration complete' : 'Bonding curve progress';
      appState.setCoinField('#coin-chart-heading', `${symbol} · market cap in USD`); appState.setCoinField('#coin-full-address', mintAddress);
      const chartFooter = document.querySelector('.coin-chart-panel > .chart-footer'); if (chartFooter) chartFooter.innerHTML = `<span>Total supply <b>${appState.formatOnChainNumber(supply, 6)}</b></span>`;
      const policyEyebrow = document.querySelector('.coin-policy-card .eyebrow'); if (policyEyebrow) policyEyebrow.textContent = 'On-chain account';
      const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = graduatedPool ? 'Canonical PumpSwap pool' : curve ? 'Pump bonding curve' : 'Curve unavailable';
      appState.renderCoinCreatorRoute(curve?.creator || '');
      appState.renderCoinCreatorHeader(curve?.creator || '');
      document.querySelector('#coin-launched-by')?.remove();
      if (registeredLaunch?.creatorWallet) {
        const authorLink = document.createElement('a'); authorLink.id = 'coin-launched-by';
        authorLink.href = `/wallet/${encodeURIComponent(registeredLaunch.creatorWallet)}`;
        authorLink.textContent = `Launched by ${appState.shortAddress(registeredLaunch.creatorWallet)}`;
        document.querySelector('.coin-attribution')?.append(authorLink);
      }
      const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = graduatedPool ? `<span><b>${appState.formatOnChainNumber(graduatedPool.baseTokenReserves, 0)}</b><small>Pool tokens</small></span><span><b>${appState.formatOnChainNumber(graduatedPool.quoteReservesSol, 6)} SOL</b><small>Pool quote reserve</small></span>` : curve ? `<span><b>${curve.complete ? 'Complete' : 'Active'}</b><small>Curve state</small></span><span><b>${appState.formatOnChainNumber(curve.realTokenReserves, 0)}</b><small>Real tokens</small></span>` : '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Creator</small></span>';
      const policyBar = document.querySelector('.policy-bar'); if (policyBar) policyBar.innerHTML = curve ? `<i style="display:block;height:100%;width:${Math.max(0, Math.min(100, Number(curve.progressPercent) || 0))}%;background:#83cbb0"></i>` : '<i style="display:block;height:100%;width:100%;background:#667085"></i>';
       const policyLink = document.querySelector('.policy-link'); if (policyLink) { policyLink.textContent = graduatedPool ? 'View PumpSwap pool on explorer →' : 'View mint on explorer →'; policyLink.href = appState.exploreExplorer(`address/${graduatedPool?.pool || mintAddress}`); policyLink.hidden = false; }
      const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = appState.exploreExplorer(`address/${mintAddress}`); explorerLink.hidden = false; }
      appState.setCoinField('#coin-network', `Solana`);
      if (appState.EXPLORE_CLUSTER === 'devnet') void appState.apiRequest(`/devnet-metadata/${encodeURIComponent(mintAddress)}`, { signal: AbortSignal.timeout(5000) }).then(response => {
        if (loadId !== appState.coinLoadId || !response.available || response.data?.name !== name || response.data?.symbol !== symbol) return;
        const details = response.data;
        appState.setCoinField('#coin-description', details.description || 'Signed Solana metadata is available.');
        const tagline = document.querySelector('#coin-profile-tagline');
        if (tagline) { tagline.textContent = details.tagline || ''; tagline.hidden = !details.tagline; }
        window.fundedSetCoinProfileMetadata?.(details);
        appState.setCoinFact('#coin-metadata-status', 'Name and symbol confirmed', 'clear');
        if (appState.isDevnetImageUri(details.image, mintAddress)) {
          const avatar = document.querySelector('#coin-avatar');
          if (avatar) { avatar.textContent = ''; avatar.style.backgroundImage = `url("${details.image}")`; avatar.style.backgroundSize = 'cover'; avatar.style.backgroundPosition = 'center'; }
        }
        for (const [selector, href] of [['#coin-website-link', details.website], ['#coin-x-link', details.twitter], ['#coin-telegram-link', details.telegram], ['#coin-discord-link', details.discord]]) {
          const link = document.querySelector(selector); if (link && typeof href === 'string' && href.startsWith('https://')) { link.href = href; link.hidden = false; }
        }
        appState.compactCoinSocials();
      }).catch(() => {});
      void appState.loadSolUsdQuote();
      if (curve && appState.EXPLORE_CLUSTER === 'devnet') void appState.loadCoinMarketActivity(mintAddress, loadId, decimals, curve.complete === true);
      else { appState.coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals }; appState.renderCoinSummary(); appState.renderCoinPricePath(); appState.renderCoinFlow(NaN, NaN); appState.renderCoinPulse(); appState.setCoinField('#coin-trade-count', 'Unavailable'); appState.setCoinField('#coin-trade-breakdown', 'Pump curve required'); appState.setCoinTabLabels(); appState.renderCoinActivityTab(); }
    } catch (error) {
      if (loadId !== appState.coinLoadId) return;
      console.error('On-chain token detail failed', error);
      const detail = String(error?.message || '');
      appState.renderOnChainUnavailable(/\b429\b|rate limit|too many requests/i.test(detail)
        ? 'Solana RPC is rate limited. Wait a moment, then select Refresh.'
        : /timed out/i.test(detail)
          ? 'Solana RPC timed out. Check your connection and select Refresh.'
          : detail || 'Solana RPC could not load this mint.');
      appState.renderCoinRegistryIdentity(mintAddress);
    }
  }
  // app-source-end

  return { loadCoinOnChain };
}
