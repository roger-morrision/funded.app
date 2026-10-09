// Dependencies and mutable application state are read live through appState.
export function createExploreFiltersController(appState) {
  // app-source: 405
  function formatFeedAge(timestamp){
    const ms = Date.parse(String(timestamp || ''));
    return Number.isFinite(ms) ? appState.formatOnchainAge(ms) : 'freshness unavailable';
  }
  // app-source-end

  // app-source: 406
  function marketUsdFilterToSol(value){
    if (value == null) return null;
    return Number.isFinite(appState.coinSolUsdPrice) && appState.coinSolUsdPrice > 0 ? value / appState.coinSolUsdPrice : Infinity;
  }
  // app-source-end

  // app-source: 407
  function exploreFilterOptions(query = appState.exploreQuery, sort = appState.exploreSort){
    const laneStage = appState.exploreNewLane === 'almost' ? 'near' : appState.exploreNewLane === 'migrated' ? 'migrated' : appState.exploreNewLane === 'launch' ? 'launch' : 'all';
    return { query, sort, risk: appState.exploreRisk, stage: appState.exploreTab === 'new' ? laneStage : appState.exploreStage, authority: appState.exploreAuthority,
      promotion: appState.explorePromotion, reward: appState.exploreReward, watchlist: appState.getWatchlist(), maxAgeHours: appState.exploreMaxAgeHours,
      minVolumeSol: appState.EXPLORE_CLUSTER === 'devnet' ? appState.marketUsdFilterToSol(appState.exploreMinVolumeUsd) : null,
      minCurveCapSol: appState.EXPLORE_CLUSTER === 'devnet' ? appState.marketUsdFilterToSol(appState.exploreMinMarketCapUsd) : null,
      minTrades: appState.EXPLORE_CLUSTER === 'devnet' ? appState.exploreMinTrades : null,
      minTraders: appState.EXPLORE_CLUSTER === 'devnet' ? appState.exploreMinTraders : null };
  }
  // app-source-end

  // app-source: 408
  function filterExploreTabRecords(records, query = appState.exploreQuery){
    const filtered = appState.filterMarketRecords(records, appState.exploreFilterOptions(query));
    if (appState.exploreTab !== 'following') return filtered;
    const saved = new Set(appState.getWatchlist());
    return filtered.filter(record => saved.has(record.address));
  }
  // app-source-end

  // app-source: 409
  function formatExploreTradeCount(value, coverage){
    return value == null || !Number.isInteger(Number(value)) ? '—' : `${coverage === 'partial' ? '≥' : ''}${Number(value).toLocaleString()}`;
  }
  // app-source-end

  // app-source: 410
  function verifiedPaidListingPayment(record){
    const payment = record?.listingPayment;
    return appState.EXPLORE_CLUSTER === 'devnet' && payment?.verified !== false
      && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(payment?.signature || '')) ? payment : null;
  }
  // app-source-end

  // app-source: 411
  function explorePaidListingBagMarkup(record){
    const payment = appState.verifiedPaidListingPayment(record);
    if (!payment) return '';
    const amount = Number(payment.amountTokens);
    const burn = Number.isSafeInteger(amount) && amount > 0 ? `${amount.toLocaleString()} $FUNDED burn` : '$FUNDED burn';
    const label = `Verified paid listing · ${burn} · view transaction receipt`;
    return `<a class="explore-paid-listing-bag" href="${appState.escapeHtml(appState.exploreExplorer(`tx/${encodeURIComponent(payment.signature)}`))}" target="_blank" rel="noopener noreferrer" aria-label="${appState.escapeHtml(label)}" title="${appState.escapeHtml(label)}">${appState.icon('listingBag')}</a>`;
  }
  // app-source-end

  // app-source: 412
  function exploreStageLabel(record){
    if (appState.verifiedPaidListingPayment(record) && record.complete == null) return 'Paid listing · mint verified';
    return record.migrated === true ? 'Migrated' : record.complete === true ? 'Curve complete' : record.complete === false ? 'On curve' : 'Stage unverified';
  }
  // app-source-end

  // app-source: 413
  function exploreDevnetVolumeLabel(record){ return appState.verifiedPaidListingPayment(record) && record.complete == null ? 'Trade activity' : record.migrated === true ? 'Pool activity' : '24h traded'; }
  // app-source-end

  // app-source: 414
  function exploreDevnetVolume(record){ return record.migrated === true ? 'Unindexed' : appState.formatExploreUsd(record.volume24hSol, { partial: record.volumeCoverage === 'partial' }); }
  // app-source-end

  // app-source: 415
  function exploreDevnetReserveLabel(record){ return appState.verifiedPaidListingPayment(record) && record.complete == null ? 'Liquidity' : record.migrated === true ? 'Pool reserve' : 'Curve reserve'; }
  // app-source-end

  // app-source: 416
  function exploreDevnetReserve(record){ return appState.formatCoinUsd(record.migrated === true ? record.poolReserveSol : record.curveReserveSol); }
  // app-source-end

  // app-source: 417
  function exploreMarketCapLabel(record){ return appState.verifiedPaidListingPayment(record) && record.complete == null ? 'Market cap' : appState.EXPLORE_CLUSTER === 'devnet' ? record.migrated === true ? 'Pool MC' : 'Curve MC' : 'Market cap'; }
  // app-source-end

  // app-source: 418
  function exploreMarketCapUsd(record){
    const cap = appState.EXPLORE_CLUSTER === 'devnet' ? record.migrated === true ? record.poolMarketCapSol : record.curveCapSol : record.marketCapUsd;
    if (cap == null || cap === '' || (appState.EXPLORE_CLUSTER === 'devnet' && !Number.isFinite(appState.coinSolUsdPrice))) return '$—';
    const usd = appState.EXPLORE_CLUSTER === 'devnet' ? Number(cap) * appState.coinSolUsdPrice : Number(cap);
    return Number.isFinite(usd) && usd >= 0 ? appState.formatDashboardUsd(usd) : '$—';
  }
  // app-source-end

  // app-source: 419
  function renderExplorePulse(records){
    return appState.renderExplorePulseView(records, { exploreLastVerifiedAt: appState.exploreLastVerifiedAt, exploreProviderStatus: appState.exploreProviderStatus, exploreTab: appState.exploreTab, exploreNewLane: appState.exploreNewLane }, {  });
  }
  // app-source-end

  // app-source: 420
  function exploreEmptyReason(){
    return appState.exploreEmptyReasonView({ exploreTab: appState.exploreTab, assets: appState.assets, exploreMinVolumeUsd: appState.exploreMinVolumeUsd, exploreMinMarketCapUsd: appState.exploreMinMarketCapUsd, coinSolUsdPrice: appState.coinSolUsdPrice, exploreQuery: appState.exploreQuery, explorePromotion: appState.explorePromotion, exploreReward: appState.exploreReward, exploreMinTraders: appState.exploreMinTraders, exploreMinTrades: appState.exploreMinTrades, exploreMaxAgeHours: appState.exploreMaxAgeHours, exploreAuthority: appState.exploreAuthority, exploreRisk: appState.exploreRisk, exploreNewLane: appState.exploreNewLane, exploreStage: appState.exploreStage }, { getWatchlist: appState.getWatchlist });
  }
  // app-source-end

  // app-source: 421
  function renderExploreControls(){
    return appState.renderExploreControlsView({ exploreView: appState.exploreView, exploreTab: appState.exploreTab, exploreWindow: appState.exploreWindow, exploreSort: appState.exploreSort, verifiedBoostsAvailable: appState.verifiedBoostsAvailable, assets: appState.assets, verifiedBoosts: appState.verifiedBoosts, exploreRisk: appState.exploreRisk, exploreStage: appState.exploreStage, exploreAuthority: appState.exploreAuthority, explorePromotion: appState.explorePromotion, exploreReward: appState.exploreReward, exploreMaxAgeHours: appState.exploreMaxAgeHours, exploreMinVolumeUsd: appState.exploreMinVolumeUsd, exploreMinMarketCapUsd: appState.exploreMinMarketCapUsd, exploreMinTrades: appState.exploreMinTrades, exploreMinTraders: appState.exploreMinTraders, exploreUpdatedAt: appState.exploreUpdatedAt, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, {  });
  }
  // app-source-end

  // app-source: 422
  function formatVerifiedPercent(value){
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
  // app-source-end

  // app-source: 423
  function renderExploreBenefitLeaders(records){
    return appState.renderExploreBenefitLeadersView(records, { exploreWindow: appState.exploreWindow, exploreSort: appState.exploreSort }, { formatVerifiedPercent: appState.formatVerifiedPercent, formatExploreUsd: appState.formatExploreUsd });
  }
  // app-source-end

  // app-source: 424
  function formatPayoutSol(value) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return '—';
    const units = BigInt(value);
    const whole = units / 1_000_000_000n;
    const fraction = String(units % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
    return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ''} SOL`;
  }
  // app-source-end

  // app-source: 425
  function renderExplorePayoutStats(){
    return appState.renderExplorePayoutStatsView({ analyticsSummary: appState.analyticsSummary, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { formatPayoutSol: appState.formatPayoutSol });
  }
  // app-source-end

  // app-source: 426
  function exploreSocialLinksMarkup(record) {
    const links = appState.exploreSocialLinks(record, appState.verifiedLaunchPolicyForMint(record.address));
    if (!links.length) return '';
    const symbol = appState.escapeHtml(record.symbol || 'token');
    return `<span class="explore-social-links" role="group" aria-label="Token social links">${links.map(({ icon: iconName, label, href }) => `<a class="explore-social-link" href="${appState.escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${symbol} ${label} link" title="${appState.escapeHtml(label)}">${appState.icon(iconName)}</a>`).join('')}</span>`;
  }
  // app-source-end

  // app-source: 427
  function exploreAssetCardMarkup(a){
    return appState.exploreAssetCardMarkupView(a, { verifiedBoosts: appState.verifiedBoosts, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { formatOnchainAge: appState.formatOnchainAge, exploreStageLabel: appState.exploreStageLabel, exploreSocialLinksMarkup: appState.exploreSocialLinksMarkup, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, verifiedPaidListingPayment: appState.verifiedPaidListingPayment, explorePaidListingBagMarkup: appState.explorePaidListingBagMarkup, exploreDevnetVolumeLabel: appState.exploreDevnetVolumeLabel, exploreDevnetVolume: appState.exploreDevnetVolume, exploreDevnetReserveLabel: appState.exploreDevnetReserveLabel, exploreDevnetReserve: appState.exploreDevnetReserve, exploreMarketCapLabel: appState.exploreMarketCapLabel, exploreMarketCapUsd: appState.exploreMarketCapUsd, tokenCardAddressesMarkup: appState.tokenCardAddressesMarkup, exploreBoostStatus: appState.exploreBoostStatus });
  }
  // app-source-end

  // app-source: 428
  function decorateExploreAssetCard(card, asset, launch = appState.verifiedLaunchPolicyForMint(asset.address)){
    return appState.decorateExploreAssetCardView(card, asset, launch, { exploreProviderStatus: appState.exploreProviderStatus, exploreWindow: appState.exploreWindow, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, loadPortfolioLogo: appState.loadPortfolioLogo, promotionElement: appState.promotionElement, formatExploreUsd: appState.formatExploreUsd, formatVerifiedPercent: appState.formatVerifiedPercent, formatExploreTradeCount: appState.formatExploreTradeCount, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 429
  function exploreOutageCopy(){
    if (/RPC (?:rate limited|unavailable)/i.test(appState.exploreProviderStatus)) return {
      title: 'Solana verification unavailable.',
      detail: `${appState.exploreProviderStatus}. Retry verification when RPC access recovers; unverified tokens remain hidden.`,
    };
    return {
      title: 'Tokens are temporarily unavailable.',
      detail: 'We couldn’t load tokens right now. Please try again.',
    };
  }
  // app-source-end

  // app-source: 430
  function renderExploreAssets({ force = false } = {}){
    return appState.renderExploreAssetsView({ force }, { exploreProviderStatus: appState.exploreProviderStatus, exploreLastVerifiedAt: appState.exploreLastVerifiedAt, exploreFeedAvailable: appState.exploreFeedAvailable, assets: appState.assets, exploreWindow: appState.exploreWindow, exploreScannedCount: appState.exploreScannedCount, verifiedBoosts: appState.verifiedBoosts, exploreTab: appState.exploreTab, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { exploreOutageCopy: appState.exploreOutageCopy, withVerifiedExploreBenefits: appState.withVerifiedExploreBenefits, filterExploreTabRecords: appState.filterExploreTabRecords, renderExploreControls: appState.renderExploreControls, renderExplorePulse: appState.renderExplorePulse, renderExploreBenefitLeaders: appState.renderExploreBenefitLeaders, formatExploreUsd: appState.formatExploreUsd, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, exploreStageLabel: appState.exploreStageLabel, loadVerifiedTokenLogos: appState.loadVerifiedTokenLogos, homeLaunchCardMarkup: appState.homeLaunchCardMarkup, launchCardVolumeUsd: appState.launchCardVolumeUsd, exploreEmptyReason: appState.exploreEmptyReason, decorateHomeLaunchCard: appState.decorateHomeLaunchCard, renderWatchlist: appState.renderWatchlist, renderWalletDetail: appState.renderWalletDetail });
  }
  // app-source-end

  // app-source: 434
  function renderStonkEnhancements(){
    const quoteList = document.querySelector('#quote-asset-list');
    const quoteStatus = document.querySelector('#quote-assets-status');
    if (!quoteList) return;
    const quoteLoad = appState.apiRequest('/api/quote-assets').then(result => {
      const verified = result.data?.status === 'onchain-verified-catalog' && result.data?.cluster === appState.EXPLORE_CLUSTER;
      const assets = verified && Array.isArray(result.data?.assets) ? result.data.assets : [];
      if (quoteStatus) quoteStatus.textContent = verified ? `${assets.length} available` : 'Unavailable';
      if (quoteList) quoteList.innerHTML = assets.length ? assets.map(item => `<div class="quote-asset-row"><span class="asset-icon" aria-hidden="true">${appState.escapeHtml(item.symbol.slice(0, 1))}</span><span><strong>${appState.escapeHtml(item.symbol)}</strong><small>${appState.escapeHtml(item.name)} · ${appState.escapeHtml(item.category)}</small></span><b>✓</b></div>`).join('') : '<div class="empty-state">No verified trading currencies are available for this network.</div>';
    }).catch(() => { if (quoteStatus) quoteStatus.textContent = 'Unavailable'; if (quoteList) quoteList.innerHTML = '<div class="empty-state">Quote catalog unavailable; no unverified assets shown.</div>'; });
    return quoteLoad;
  }
  // app-source-end

  // app-source: 435
  function formatOnchainAge(timestamp){
    if (!timestamp) return 'confirmed on-chain';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }
  // app-source-end

  return { formatFeedAge, marketUsdFilterToSol, exploreFilterOptions, filterExploreTabRecords, formatExploreTradeCount, verifiedPaidListingPayment, explorePaidListingBagMarkup, exploreStageLabel, exploreDevnetVolumeLabel, exploreDevnetVolume, exploreDevnetReserveLabel, exploreDevnetReserve, exploreMarketCapLabel, exploreMarketCapUsd, renderExplorePulse, exploreEmptyReason, renderExploreControls, formatVerifiedPercent, renderExploreBenefitLeaders, formatPayoutSol, renderExplorePayoutStats, exploreSocialLinksMarkup, exploreAssetCardMarkup, decorateExploreAssetCard, exploreOutageCopy, renderExploreAssets, renderStonkEnhancements, formatOnchainAge };
}
