// Dependencies and mutable application state are read live through appState.
export function createTokenCardsController(appState) {
  // app-source: 296
  function verifiedLaunchPolicyForMint(mint){
    return appState.verifiedLaunchPolicies.find(launch => launch.mint === mint) || null;
  }
  // app-source-end

  // app-source: 297
  function verifiedPolicyPercent(value){
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }
  // app-source-end

  // app-source: 298
  function withVerifiedExploreBenefits(record){
    const policy = appState.verifiedLaunchPolicyForMint(record.address || record.mint);
    if (!policy) return { ...record, benefitPolicyVerified: false, promotionTier: null, promotionBurnTokens: null, postLaunchBoostMultiplier: appState.activeBoostMultiplier(appState.verifiedBoosts[record.address || record.mint]), communityAirdropPercent: null, holderFeePercent: null, xFeePercent: null, creatorFeePercent: null };
    const paidPromotion = appState.verifiedPromotionBadge(policy);
    const shares = policy.feeDistribution?.creatorDirected?.shares || {};
    return {
      ...record,
      benefitPolicyVerified: true,
      promotionTier: paidPromotion?.tier || 'standard',
      postLaunchBoostMultiplier: appState.activeBoostMultiplier(appState.verifiedBoosts[record.address || record.mint]),
      promotionBurnTokens: paidPromotion && Number.isFinite(Number(paidPromotion.amountTokens)) ? Math.max(0, Number(paidPromotion.amountTokens)) : 0,
      communityAirdropPercent: appState.verifiedPolicyPercent(policy.communityAirdrop?.allocationPercent),
      holderFeePercent: appState.verifiedPolicyPercent(shares.holderAirdropPercent),
      xFeePercent: appState.verifiedPolicyPercent(shares.solClaimPercent),
      creatorFeePercent: appState.verifiedPolicyPercent(shares.creatorWalletPercent),
    };
  }
  // app-source-end

  // app-source: 299
  function promotionElement(mint, withProof = false){
    const badge = appState.promotionForMint(mint);
    if (!badge) return null;
    const element = document.createElement(withProof ? 'a' : 'span');
    element.className = `promotion-badge promotion-badge--${badge.tier}`;
    element.textContent = badge.label;
    element.title = `${badge.amountTokens.toLocaleString()} $FUNDED burned in the creation transaction · paid promotion, not a token safety endorsement`;
    if (withProof) {
      element.href = appState.exploreExplorer(`tx/${encodeURIComponent(badge.signature)}`);
      element.target = '_blank';
      element.rel = 'noopener noreferrer';
      element.setAttribute('aria-label', `${badge.tier} promotion burn proof on Solana Explorer`);
    }
    return element;
  }
  // app-source-end

  // app-source: 300
  function renderCoinPromotionBadge(){
    return appState.renderCoinPromotionBadgeView({ verifiedBoosts: appState.verifiedBoosts, verifiedBoostsAvailable: appState.verifiedBoostsAvailable }, { getCoinMintAddress: appState.getCoinMintAddress, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, renderCoinRegistryIdentity: appState.renderCoinRegistryIdentity, renderCoinRewardsPolicy: appState.renderCoinRewardsPolicy, exploreExplorer: appState.exploreExplorer });
  }
  // app-source-end

  // app-source: 302
  function renderCoinRegistryIdentity(mint){
    if (document.querySelector('#coin-rpc-status')?.textContent?.trim() !== 'Data unavailable') return;
    const launch = appState.verifiedLaunchPolicyForMint(mint);
    if (!launch?.onchainVerified) return;
    const name = typeof launch.name === 'string' ? launch.name.trim() : '';
    const symbol = typeof launch.symbol === 'string' ? launch.symbol.trim() : '';
    if (!name && !symbol) return;
    appState.setCoinField('#coin-page-title', name || 'Verified launch');
    appState.setCoinField('#coin-symbol', symbol || '—');
    appState.setCoinField('#coin-artwork-symbol', symbol || '—');
    appState.setCoinField('#coin-avatar', (symbol || name).slice(0, 1).toUpperCase());
    appState.setCoinField('#coin-description', 'This coin’s name and symbol are confirmed. Current trading and holder details are unavailable.');
    appState.setCoinFact('#coin-metadata-status', 'Verified launch registry', 'clear');
    if (appState.isDevnetImageUri(launch.imageUri, mint)) {
      const avatar = document.querySelector('#coin-avatar');
      if (avatar) {
        avatar.textContent = '';
        avatar.style.backgroundImage = `url("${launch.imageUri}")`;
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
      }
    }
  }
  // app-source-end

  // app-source: 303
  function getWalletLaunchPolicies(){
    return appState.walletLaunches(appState.verifiedLaunchPolicies, appState.connectedWalletAddress);
  }
  // app-source-end

  // app-source: 304
  function portfolioHolderCount(asset){
    const indexed = asset?.holders == null || asset.holders === '' ? NaN : Number(asset.holders);
    if (Number.isFinite(indexed) && indexed >= 0) return indexed.toLocaleString();
    const holders = asset?.holderWalletCount == null || asset.holderWalletCount === '' ? NaN : Number(asset.holderWalletCount);
    if (Number.isFinite(holders) && holders >= 0) return `${asset?.holderWalletCoverage === 'lower-bound' ? '≥' : ''}${holders.toLocaleString()}`;
    const cached = appState.homeHolderCountCache.get(asset?.address);
    if (cached && Date.now() - cached.at < 300_000 && Number.isFinite(cached.count) && cached.count >= 0) {
      return `${cached.coverage === 'lower-bound' ? '≥' : ''}${cached.count.toLocaleString()}`;
    }
    return '—';
  }
  // app-source-end

  // app-source: 305
  function loadTokenLogo(avatar, launch, { probeMissing = false } = {}){
    const mint = String(launch?.mint || '');
    if (!avatar || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || (!probeMissing && !appState.isDevnetImageUri(launch?.imageUri, mint))) return;
    const sources = [`/devnet-images/${encodeURIComponent(mint)}`, appState.devnetImageUri(mint)];
    let next = 0;
    const trySource = () => {
      if (!avatar.isConnected || next >= sources.length) return;
      const image = new Image();
      image.alt = '';
      image.decoding = 'async';
      image.onload = () => { if (avatar.isConnected) { avatar.replaceChildren(image); avatar.removeAttribute('title'); } };
      image.onerror = trySource;
      image.src = sources[next++];
    };
    trySource();
  }
  // app-source-end

  // app-source: 306
  function loadPortfolioLogo(card, launch, options){
    appState.loadTokenLogo(card?.querySelector('.portfolio-token-avatar, .asset-icon, .wallet-activity-icon, .home-token-avatar, .home-holder-reward-avatar, .claim-token-mark, .claim-token > span, .explore-ticker-token > i, .explore-tape-logo, .terminal-signal-logo, .leader-token-logo, .coin-trade-token-avatar'), launch, options);
  }
  // app-source-end

  // app-source: 307
  function loadVerifiedTokenLogos(container, options){
    container?.querySelectorAll('[data-logo-mint]').forEach(row => appState.loadPortfolioLogo(row, appState.verifiedLaunchPolicyForMint(row.dataset.logoMint), options));
  }
  // app-source-end

  // app-source: 308
  function tokenCardCreatorWallet(mint){
    return appState.tokenCardData({ mint, policy: appState.verifiedLaunchPolicyForMint(mint) }).launchWallet;
  }
  // app-source-end

  // app-source: 309
  function tokenCardAddressesMarkup(mint, creatorWallet = appState.tokenCardCreatorWallet(mint)){
    if (!mint) return '';
    const address = (value, kind, label) => `<span title="${appState.escapeHtml(label)}: ${appState.escapeHtml(value)}"><small>${appState.escapeHtml(label)}</small><code>${appState.escapeHtml(value.slice(0, 5))}…${appState.escapeHtml(value.slice(-4))}</code><button type="button" class="token-card-copy-address" data-copy-address="${appState.escapeHtml(value)}" data-copy-kind="${kind}" aria-label="Copy full ${kind === 'creator' ? 'launch wallet' : 'token'} address" title="Copy full ${kind === 'creator' ? 'launch wallet' : 'token'} address">${appState.icon('copy')}</button></span>`;
    return `<div class="token-card-addresses">${address(mint, 'token', 'CA')}${creatorWallet ? address(creatorWallet, 'creator', 'Launch wallet') : ''}</div>`;
  }
  // app-source-end

  // app-source: 310
  function tokenCardWatchMarkup(mint, symbol){
    const saved = appState.getWatchlist().includes(mint);
    return `<button type="button" class="watch-button token-card-action-watch${saved ? ' active' : ''}" data-mint="${appState.escapeHtml(mint || '')}" aria-label="${saved ? 'Remove token from favorites' : `Add ${appState.escapeHtml(symbol || 'token')} to favorites`}" aria-pressed="${saved}" title="${saved ? 'Remove from favorites' : 'Add to favorites'}">${appState.icon(saved ? 'starFilled' : 'star')}</button>`;
  }
  // app-source-end

  // app-source: 311
  function tokenCardShareMarkup(mint, symbol, name){
    return `<button type="button" class="share-asset token-card-action-share" data-share-mint="${appState.escapeHtml(mint || '')}" data-share-symbol="${appState.escapeHtml(symbol || 'TOKEN')}" data-share-name="${appState.escapeHtml(name || '')}" aria-label="Share ${appState.escapeHtml(symbol || 'token')}">${appState.icon('share')}<span>Share</span></button>`;
  }
  // app-source-end

  // app-source: 312
  function portfolioTokenCardMarkup({ mint, name, symbol, removable = false }){
    return appState.portfolioTokenCardMarkupView({ mint, name, symbol, removable }, { assets: appState.assets, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { exploreStageLabel: appState.exploreStageLabel, formatCoinUsd: appState.formatCoinUsd, launchCardVolumeUsd: appState.launchCardVolumeUsd, portfolioHolderCount: appState.portfolioHolderCount, exploreBoostAmountMarkup: appState.exploreBoostAmountMarkup, tokenCardWatchMarkup: appState.tokenCardWatchMarkup, tokenCardShareMarkup: appState.tokenCardShareMarkup });
  }
  // app-source-end

  // app-source: 313
  function renderCreatorLaunches(){
    return appState.renderCreatorLaunchesView({ verifiedLaunchPoliciesStatus: appState.verifiedLaunchPoliciesStatus, connectedWalletAddress: appState.connectedWalletAddress, assets: appState.assets, exploreWindow: appState.exploreWindow, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { getWalletLaunchPolicies: appState.getWalletLaunchPolicies, withVerifiedExploreBenefits: appState.withVerifiedExploreBenefits, homeLaunchCardMarkup: appState.homeLaunchCardMarkup, launchCardVolumeUsd: appState.launchCardVolumeUsd, decorateHomeLaunchCard: appState.decorateHomeLaunchCard, loadPortfolioLogo: appState.loadPortfolioLogo, setWatchButtonState: appState.setWatchButtonState, getWatchlist: appState.getWatchlist });
  }
  // app-source-end

  // app-source: 315
  function formatTokenAmount(value){ return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  // app-source-end

  // app-source: 316
  function formatVerifiedAirdropAmount(value){ return value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  // app-source-end

  return { verifiedLaunchPolicyForMint, verifiedPolicyPercent, withVerifiedExploreBenefits, promotionElement, renderCoinPromotionBadge, renderCoinRegistryIdentity, getWalletLaunchPolicies, portfolioHolderCount, loadTokenLogo, loadPortfolioLogo, loadVerifiedTokenLogos, tokenCardCreatorWallet, tokenCardAddressesMarkup, tokenCardWatchMarkup, tokenCardShareMarkup, portfolioTokenCardMarkup, renderCreatorLaunches, formatTokenAmount, formatVerifiedAirdropAmount };
}
