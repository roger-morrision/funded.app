// Dependencies and mutable application state are read live through appState.
export function createCoinStateController(appState) {
  // app-source: 979
  function resetCoinSurface(mintAddress){
    appState.coinTradeEstimate = null;
    appState.renderTradeAmountEstimate();
    document.querySelector('#coin-profile-about-tab')?.click();
    document.querySelector('#coin-launched-by')?.remove();
    appState.ensureCoinChatTab();
    appState.ensureCoinPolicyAccordion();
    const coinMainColumn = document.querySelector('.coin-main-column');
    const transactionPanel = document.querySelector('.coin-tabs-panel');
    if (coinMainColumn && transactionPanel?.parentElement !== coinMainColumn) coinMainColumn.append(transactionPanel);
    appState.ensureCoinCommunityPanel();
    appState.renderCoinCreatorHeader('');
    appState.coinChatMessages = [];
    appState.coinChatState = { loading: true, enabled: false, reason: '' };
    appState.renderCoinCommunityPanel();
    appState.coinActivity = { status: 'loading', collections: [], claims: [], accounts: [] };
    appState.coinSummaryLaunch = null;
    appState.coinSummaryLedgerMint = null;
    appState.renderCoinFeeDashboard();
    appState.renderCoinAccountDistribution(null);
    appState.coinMarketActivity = { status: 'loading', trades: [], coverage: null, decimals: 6 };
    appState.coinSolUsdValues = { spot: NaN, marketCap: NaN, reserve: NaN, virtualQuote: NaN, supply: NaN };
    appState.coinTradeFilter = 'all';
    appState.coinTradeSort = { key: 'date', direction: 'desc' };
    appState.coinTradeOpenFilter = null;
    appState.coinPulsePeriod = '24h';
    appState.coinChartPeriod = '24h';
    document.querySelectorAll('#coin-page [data-coin-trade-input]').forEach(input => { input.value = input.dataset.coinTradeInput === 'side' ? 'all' : ''; });
    document.querySelectorAll('[data-coin-tab]').forEach(button => button.classList.toggle('active', button.dataset.coinTab === 'trades'));
    document.querySelectorAll('[data-coin-trade-filter]').forEach(button => { const active = button.dataset.coinTradeFilter === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    appState.renderCoinFlow(NaN, NaN); appState.renderCoinPulse();
    const path = document.querySelector('#coin-price-path'); if (path) path.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Reading trade observations…</strong><small>This is not a historical candle chart.</small></div>';
    const tradeMint = document.querySelector('#trade-mint'); if (tradeMint) tradeMint.value = mintAddress || '';
    void appState.refreshTradeBalances();
    appState.invalidateTradePreview();
    appState.queueTradeQuote();
    appState.setCoinTabLabels(); appState.renderCoinActivityTab();
    appState.setCoinField('.coin-live-dot', 'Checking data');
    appState.setCoinField('#coin-avatar', '?'); appState.setCoinField('#coin-symbol', 'TOKEN'); appState.setCoinField('#coin-artwork-symbol', 'TOKEN'); appState.setCoinField('#coin-page-title', 'Loading token…'); appState.setCoinField('#coin-address', appState.shortAddress(mintAddress));
    appState.setCoinFact('#coin-stage', 'Checking curve'); appState.setCoinFact('#coin-fee-owner', 'Checking route'); appState.setCoinFact('#coin-metadata-status', 'Reading mint');
    appState.setCoinFact('#coin-mint-authority', 'Checking…'); appState.setCoinFact('#coin-freeze-authority', 'Checking…');
    const avatar = document.querySelector('#coin-avatar'); if (avatar) avatar.style.backgroundImage = '';
    const artwork = document.querySelector('.coin-artwork'); if (artwork) { delete artwork.dataset.bannerUrl; artwork.style.backgroundImage = ''; artwork.classList.remove('has-image'); }
    const tagline = document.querySelector('#coin-profile-tagline'); if (tagline) { tagline.textContent = ''; tagline.hidden = true; }
    window.fundedSetCoinProfileMetadata?.({});
    ['#coin-website-link', '#coin-x-link', '#coin-telegram-link', '#coin-discord-link'].forEach(selector => { const link = document.querySelector(selector); if (link) { link.hidden = true; link.removeAttribute('href'); } });
    appState.compactCoinSocials();
    appState.setCoinField('#coin-description', 'Checking coin details on Solana…');
    appState.setCoinField('#coin-market-cap-label', 'Estimated market cap'); appState.setCoinField('#coin-market-cap-source', 'Reading confirmed Solana RPC state');
    appState.setCoinField('#coin-liquidity-label', 'Reserve');
    const explorerLink = document.querySelector('#coin-explorer-link'); if (explorerLink) { explorerLink.href = appState.exploreExplorer(`address/${encodeURIComponent(mintAddress)}`); explorerLink.hidden = !mintAddress; }
    document.querySelectorAll('.coin-chart-panel .chart-tools button').forEach(button => { button.disabled = true; button.title = 'Historical candles are not indexed for this token.'; });
    ['#coin-market-cap','#coin-change','#coin-strip-market-cap','#coin-volume','#coin-liquidity','#coin-holders','#coin-trade-count','#coin-holder-count','#coin-vault-share','#coin-largest-account-share','#coin-top-ten-share','#coin-supply'].forEach(selector => appState.setCoinField(selector, 'Loading…'));
    appState.setCoinField('#coin-volume-source', 'RPC trade scan if available'); appState.setCoinField('#coin-trade-breakdown', 'Confirmed Pump events'); appState.setCoinField('#coin-accounts-source', 'Largest-account sample, not holder count'); appState.setCoinCurveProgress(null);
    appState.setCoinField('#coin-chart-heading', 'Reading trade observations…');
    const footer = document.querySelector('.chart-footer'); if (footer) footer.innerHTML = '<span>Price history is unavailable</span>';
    const policyBadge = document.querySelector('.coin-policy-card .data-badge'); if (policyBadge) policyBadge.textContent = 'RPC only';
    const policyTitle = document.querySelector('.coin-policy-card h2'); if (policyTitle) policyTitle.textContent = 'Reading Pump curve…';
    appState.renderCoinCreatorRoute('');
    const policySplit = document.querySelector('.policy-split'); if (policySplit) policySplit.innerHTML = '<span><b>—</b><small>Curve state</small></span><span><b>—</b><small>Real tokens</small></span>';
    const policyBar = document.querySelector('.policy-bar'); if (policyBar) { policyBar.style.display = 'block'; policyBar.innerHTML = '<i style="display:block;height:100%;width:100%;background:#667085"></i>'; }
    const policyLink = document.querySelector('.policy-link'); if (policyLink) policyLink.hidden = true;
    appState.setCoinField('#coin-network', `Solana`);
  }
  // app-source-end

  // app-source: 980
  async function loadCoinMarketActivity(mintAddress, loadId, decimals, graduated){
    const response = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mintAddress)}/market-activity`, { signal: AbortSignal.timeout(12000) }).catch(() => ({ available: false, data: null }));
    if (loadId !== appState.coinLoadId) return;
    const market = response.available && response.data?.cluster === appState.EXPLORE_CLUSTER ? response.data : null;
    const hasPoolTradeCount = Number.isInteger(market?.poolTradeCount24h);
    const completePoolHistory = market?.poolHistoryCoverage === 'complete' && market?.coverage === 'complete';
    if (graduated && !(hasPoolTradeCount && market.poolTradeCount24h >= 0
      && (market.poolTradeCount24h > 0 || completePoolHistory)
      && ['complete', 'partial'].includes(market.coverage) && market.volume24hSol != null && Number.isFinite(Number(market.volume24hSol)))) {
      const poolScanNote = !market ? 'PumpSwap trade history is unavailable right now.'
        : !hasPoolTradeCount ? 'PumpSwap trades are missing from the available history.'
          : market.coverage === 'partial' ? 'No PumpSwap trades were found. Some history is missing.'
            : 'No confirmed PumpSwap trades were found in the last 24h.';
      appState.coinMarketActivity = { status: 'unavailable', trades: [], coverage: market?.coverage || null, decimals, graduated: true };
      appState.renderCoinPricePath(); appState.renderCoinFlow(NaN, NaN); appState.renderCoinPulse();
      appState.setCoinField('#coin-volume', 'Pool activity unavailable'); appState.setCoinField('#coin-volume-source', poolScanNote);
      appState.setCoinField('#coin-change', 'Pool change unavailable'); appState.setCoinField('#coin-trade-count', 'Unavailable');
      appState.setCoinField('#coin-trade-breakdown', hasPoolTradeCount ? 'No pool swaps observed' : 'Pool trades unavailable');
      appState.setCoinField('#coin-description', 'Trading pool confirmed. Recent trade history is unavailable.');
      appState.setCoinTabLabels(); appState.renderCoinActivityTab(); appState.renderCoinSummary();
      return;
    }
    if (!market || market.volume24hSol == null || !Number.isFinite(Number(market.volume24hSol))) {
      appState.coinMarketActivity = { status: 'unavailable', trades: [], coverage: null, decimals };
      appState.renderCoinPricePath(); appState.renderCoinFlow(NaN, NaN); appState.renderCoinPulse();
      appState.setCoinField('#coin-volume', 'Unavailable'); appState.setCoinField('#coin-volume-source', 'Trade history is unavailable right now');
      appState.setCoinField('#coin-trade-count', 'Unavailable'); appState.setCoinField('#coin-trade-breakdown', 'Trade history is unavailable right now');
      appState.setCoinTabLabels(); appState.renderCoinActivityTab();
      appState.renderCoinSummary();
      return;
    }
    const hasTradeRows = Array.isArray(market.recentTrades);
    const quote = [market.solUsdPrice, market.nativeUsdPrice, market.solPriceUsd].map(Number).find(Number.isFinite);
    if (Number.isFinite(quote) && quote > 0) {
      appState.coinSolUsdPrice = quote;
      appState.setCoinField('#coin-market-cap', appState.formatCoinUsd(appState.coinSolUsdValues.marketCap));
      appState.setCoinField('#coin-strip-market-cap', appState.formatCoinUsd(appState.coinSolUsdValues.marketCap));
      appState.setCoinField('#coin-liquidity', appState.formatCoinUsd(appState.coinSolUsdValues.reserve));
    }
    appState.coinMarketActivity = { status: hasTradeRows ? 'ready' : 'summary-only', trades: hasTradeRows ? market.recentTrades : [], activityWindows: market.activityWindows, coverage: market.coverage, decimals, graduated: Boolean(graduated), poolTradeCount24h: Number(market.poolTradeCount24h) || 0, tradeCount: Number(market.tradeCount24h) || 0, volume24hSol: Number(market.volume24hSol), buyVolume24hSol: Number(market.buyVolume24hSol), sellVolume24hSol: Number(market.sellVolume24hSol) };
    appState.renderCoinSummary();
    const partial = market.coverage === 'partial';
    appState.renderCoinPricePath(); appState.renderCoinPulse();
    appState.renderCoinFlow(market.buyVolume24hSol, market.sellVolume24hSol, partial);
    appState.setCoinField('#coin-trade-count', `${partial ? '≥' : ''}${appState.coinMarketActivity.tradeCount}`);
    const hasSideCounts = Number.isInteger(market.buyCount24h) && Number.isInteger(market.sellCount24h);
    appState.setCoinField('#coin-trade-breakdown', hasSideCounts ? `${partial ? '≥' : ''}${market.buyCount24h} buys · ${partial ? '≥' : ''}${market.sellCount24h} sells` : 'Buy/sell split unavailable');
    appState.setCoinTabLabels(); appState.renderCoinActivityTab();
    const noTrades = market.coverage === 'complete' && Number(market.tradeCount24h) === 0;
    const volume = `${market.coverage === 'partial' ? '≥' : ''}${appState.formatCoinUsd(Number(market.volume24hSol))}`;
    appState.setCoinField('#coin-volume', noTrades ? 'No trades' : market.coverage === 'partial' ? `${volume} · partial` : volume);
    appState.setCoinField('#coin-volume-source', noTrades ? 'No trades in the last 24h · history checked' : partial ? `Some ${graduated ? 'launch and pool' : 'launch'} trade history is missing · totals may be higher` : `${graduated ? 'Launch and pool trades' : 'Launch trades'} · last 24h`);
    if (graduated) appState.setCoinField('#coin-description', noTrades ? 'Trading pool confirmed. No trades in the last 24 hours.' : `Trading pool confirmed. Recent trades are shown below${partial ? ', though some history may be missing' : ''}.`);
    const change = Number(market.priceChangePercent);
    const basis = market.priceChangeBasis;
    appState.setCoinField('#coin-change', noTrades ? 'No 24h trades' : market.priceChangePercent != null && Number.isFinite(change) && basis
      ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}% ${basis === '24h' ? '24h' : 'since first trade'}`
      : '24h change unavailable');
  }
  // app-source-end

  return { resetCoinSurface, loadCoinMarketActivity };
}
