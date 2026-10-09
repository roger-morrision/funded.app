// Dependencies and mutable application state are read live through appState.
export function createLaunchPolicyController(appState) {
  // app-source: 215
  function getFundedMintAddress(){ return appState.PROTOCOL_FUNDED_MINT; }
  // app-source-end

  // app-source: 216
  function currentLaunchTierQuote(){
    if (!appState.connectedWalletAddress) return null;
    return appState.launchTierQuoteCurrent(appState.launchTierQuote, { tier:appState.launchBurnTier, payer:appState.connectedWalletAddress, mint:appState.PROTOCOL_FUNDED_MINT })
      ? appState.launchTierQuote : null;
  }
  // app-source-end

  // app-source: 217
  function currentLaunchTierAmounts(){
    return appState.launchTierPricing && Date.now() - Date.parse(appState.launchTierPricing.observedAt) < 120_000
      ? appState.launchTierPricing.amounts : null;
  }
  // app-source-end

  // app-source: 218
  function getLaunchBurnPolicy(){
    const quote = appState.currentLaunchTierQuote();
    const amounts = appState.currentLaunchTierAmounts();
    const tiers = appState.LAUNCH_BURN_TIERS.map(tier => Object.hasOwn(appState.LAUNCH_TIER_USD, tier.id)
      ? { ...tier, amountTokens:quote?.tier === tier.id ? quote.amountTokens : amounts?.[tier.id] || 0 } : tier);
    const policy = appState.buildLaunchBurnPolicy({ tierId:appState.launchBurnTier, fundedMint:appState.PROTOCOL_FUNDED_MINT || null, tiers });
    return Object.hasOwn(appState.LAUNCH_TIER_USD, policy.tier)
      ? { ...policy, quoteId:quote?.id || null, usdTarget:appState.LAUNCH_TIER_USD[policy.tier] } : policy;
  }
  // app-source-end

  // app-source: 219
  function renderFundedTokenLanding(){
    return appState.renderFundedTokenLandingView({ PROTOCOL_FUNDED_MINT: appState.PROTOCOL_FUNDED_MINT, LAUNCH_BURN_TIERS: appState.LAUNCH_BURN_TIERS, SELECTABLE_LAUNCH_TIERS: appState.SELECTABLE_LAUNCH_TIERS, exploreUpdatedAt: appState.exploreUpdatedAt, assets: appState.assets, fundedBuyRoute: appState.fundedBuyRoute, coinSolUsdPrice: appState.coinSolUsdPrice, fundedBurnState: appState.fundedBurnState, exploreLastVerifiedAt: appState.exploreLastVerifiedAt, exploreProviderStatus: appState.exploreProviderStatus, APP_EXPLORER_QUERY: appState.APP_EXPLORER_QUERY }, { validateSolanaMint: appState.validateSolanaMint, currentLaunchTierAmounts: appState.currentLaunchTierAmounts, exploreMarketCapUsd: appState.exploreMarketCapUsd });
  }
  // app-source-end

  // app-source: 222
  async function refreshLaunchTierPricing(){
    const request = ++appState.launchTierPriceRequest;
    const previousAmount = appState.getLaunchBurnPolicy().amountTokens;
    try {
      const response = await appState.apiRequest('/api/launch-tier-quote');
      if (!response.available) throw new Error(response.data?.error || 'The verified $FUNDED price is unavailable.');
      const data = response.data;
      if (data?.fundedMint !== appState.PROTOCOL_FUNDED_MINT || data?.pool !== appState.PROTOCOL_FUNDED_SWAP_POOL
        || !Number.isFinite(Number(data.tokenPriceUsd)) || Number(data.tokenPriceUsd) <= 0
        || !['pro', 'premier'].every(tier => Number.isSafeInteger(data.amounts?.[tier]) && data.amounts[tier] > 0))
        throw new Error('The launch tier quote did not match the configured $FUNDED pool.');
      if (request !== appState.launchTierPriceRequest) return;
      appState.launchTierPricing = data;
    } catch (error) {
      if (request !== appState.launchTierPriceRequest) return;
      appState.launchTierPricing = null;
      const status = document.querySelector('#launch-tier-quote-status');
      if (status) status.textContent = String(error.message || 'The verified $FUNDED price is unavailable.');
    }
    if (appState.launchBurnTier !== 'standard' && !appState.currentLaunchTierQuote() && appState.getLaunchBurnPolicy().amountTokens !== previousAmount) {
      appState.launchBurnReadiness = { ready:false, message:'Refresh the wallet and launch estimate after the $FUNDED quote changes.' };
      appState.launchCostReview = null;
      appState.estimatedLaunchFeeLamports = null;
      if (appState.wallet) appState.scheduleLaunchCostRefresh();
    }
    appState.renderLaunchBurnSelection();
    appState.renderFundedTokenLanding();
    appState.updateCostSummary();
    appState.updateLaunchButton();
  }
  // app-source-end

  // app-source: 223
  function getCreatorBuySol(){
    const value = Number(document.querySelector('#creator-buy-sol')?.value || 0);
    return Number.isFinite(value) ? value : 0;
  }
  // app-source-end

  // app-source: 224
  function developerBuyLimitReached(error = appState.walletEstimateError){
    return (error === appState.walletEstimateError && appState.estimatedInitialBuyTokens > appState.LAUNCH_TOKEN_SUPPLY * .2)
      || /developer buy cannot exceed 20% of the token supply/i.test(String(error));
  }
  // app-source-end

  // app-source: 225
  function creatorBuyExceedsWalletBalance(){
    const buySol = appState.getCreatorBuySol();
    return appState.walletBalanceLamports != null && buySol > 0 && Math.ceil(buySol * 1_000_000_000) >= appState.walletBalanceLamports;
  }
  // app-source-end

  // app-source: 226
  function getCreatorBuySummary(){
    const sol = appState.getCreatorBuySol();
    const tokens = sol > 0 ? appState.estimatedInitialBuyTokens : 0;
    const percent = tokens > 0 ? tokens / appState.LAUNCH_TOKEN_SUPPLY * 100 : 0;
    return { sol, percent, tokens };
  }
  // app-source-end

  // app-source: 227
  function getCommunityAirdropTokens(){
    const raw = document.querySelector('#community-airdrop-tokens')?.value;
    if (raw == null || String(raw).trim() === '') return NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.round(value) : NaN;
  }
  // app-source-end

  // app-source: 228
  function getCommunityAllocationPercent(){
    return appState.getCommunityAirdropTokens() / appState.LAUNCH_TOKEN_SUPPLY * 100;
  }
  // app-source-end

  // app-source: 229
  async function getLaunchReserveConfig(){
    const result = await appState.apiRequest('/api/launch-reserve-config');
    const config = result.data;
    if (!result.available || config?.cluster !== 'devnet' || config.programId !== appState.FEE_ROUTER_PROGRAM_ID
      || !appState.validateSolanaMint(config.authority).valid || !appState.validateSolanaMint(config.lookupTable).valid)
      throw new Error('Atomic community reserve custody is unavailable. Coin creation is paused.');
    return config;
  }
  // app-source-end

  // app-source: 230
  function syncCommunityAirdropPresets(){
    const tokens = appState.getCommunityAirdropTokens();
    document.querySelectorAll('[data-airdrop-tokens]').forEach(button => {
      const active = Number(button.dataset.airdropTokens) === tokens;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  // app-source-end

  // app-source: 231
  function validateSolanaMint(value){
    const address = String(value || '').trim();
    if (!address) return { valid: false, empty: true };
    try { return { valid: appState.bs58.decode(address).length === 32, address }; } catch { return { valid: false, address }; }
  }
  // app-source-end

  return { getFundedMintAddress, currentLaunchTierQuote, currentLaunchTierAmounts, getLaunchBurnPolicy, renderFundedTokenLanding, refreshLaunchTierPricing, getCreatorBuySol, developerBuyLimitReached, creatorBuyExceedsWalletBalance, getCreatorBuySummary, getCommunityAirdropTokens, getCommunityAllocationPercent, getLaunchReserveConfig, syncCommunityAirdropPresets, validateSolanaMint };
}
