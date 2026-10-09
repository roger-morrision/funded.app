// Dependencies and mutable application state are read live through appState.
export function createLaunchReviewController(appState) {
  // app-source: 619
  async function prepareLaunchMetadata({ mint, name, symbol }, session = appState.captureWalletSession()){
    appState.assertWalletSessionCurrent(session);
    if (typeof session.provider.signMessage !== 'function') throw new Error('This wallet must sign a metadata message before the Solana transaction.');
    const preview = appState.getLaunchMetadataPreview();
    appState.assertImageReady();
    const image = appState.getPreparedImage();
    if (image && (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 600_000)) throw new Error('Choose a PNG, JPG, or WEBP image under 600 KB.');
    const imageBytes = image ? new Uint8Array(await image.arrayBuffer()) : null;
    const imageSha256 = imageBytes ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', imageBytes)), byte => byte.toString(16).padStart(2, '0')).join('') : '';
    const imageBase64 = imageBytes ? appState.Buffer.from(imageBytes).toString('base64') : '';
    const record = {
      mint, creatorWallet: session.address, name, symbol,
      description: preview.description, tagline: preview.tagline, roadmap: preview.roadmap,
      website: appState.canonicalLaunchSocialUrl(preview.website, 'website'), x: appState.canonicalLaunchSocialUrl(preview.x, 'x'),
      telegram: appState.canonicalLaunchSocialUrl(preview.telegram, 'telegram'), discord: appState.canonicalLaunchSocialUrl(preview.discord, 'discord'), imageSha256,
    };
    appState.assertWalletSessionCurrent(session);
    const signed = await session.provider.signMessage(new TextEncoder().encode(appState.metadataStatement(record)));
    appState.assertWalletSessionCurrent(session);
    const response = await appState.apiRequest('/api/devnet-metadata', { method: 'POST', body: { ...record, imageBase64, imageType: image?.type || '', signature: appState.bs58.encode(signed.signature || signed) } });
    appState.assertWalletSessionCurrent(session);
    if (!response.available || response.data?.uri !== appState.devnetMetadataUri(mint)) throw new Error('Solana metadata could not be published. No token transaction was sent.');
    return response.data.uri;
  }
  // app-source-end

  // app-source: 620
  function getFeeDistributionInputs(){
    return {
      creatorWalletPercent: Number(document.querySelector('#creator-wallet-share')?.value),
      holderAirdropPercent: Number(document.querySelector('#holder-airdrop-share')?.value),
       solClaimPercent: Number(document.querySelector('#x-share')?.value),
      xRecipient: appState.normalizeXHandle(document.querySelector('#x-recipient')?.value),
    };
  }
  // app-source-end

  // app-source: 623
  function normalizeLaunchSocialField(field){
    if (field?.id === 'token-x') field.value = appState.normalizeXProfileInput(field.value);
  }
  // app-source-end

  // app-source: 624
  function launchSocialValue(field){
    return field.id === 'token-x' ? appState.normalizeXProfileInput(field.value) : field.value;
  }
  // app-source-end

  // app-source: 625
  function validPublicUrl(value, fieldId){
    try { appState.canonicalLaunchSocialUrl(value, appState.LAUNCH_SOCIAL_KINDS[fieldId]); return true; } catch { return false; }
  }
  // app-source-end

  // app-source: 626
  function invalidLaunchSocial(){
    return appState.LAUNCH_SOCIAL_FIELDS.map(id => document.getElementById(id)).find(field => {
      if (!field) return false;
      appState.updateLaunchSocialValidity(field);
      return !appState.validPublicUrl(appState.launchSocialValue(field), field.id);
    }) || null;
  }
  // app-source-end

  // app-source: 627
  function updateLaunchSocialValidity(field){
    if (!field) return;
    try { appState.canonicalLaunchSocialUrl(appState.launchSocialValue(field), appState.LAUNCH_SOCIAL_KINDS[field.id]); field.setCustomValidity(''); }
    catch (error) { field.setCustomValidity(error.message); }
  }
  // app-source-end

  // app-source: 628
  function launchEstimateRefreshAvailable({ policyValid, hasWallet, signingReady, loading, developerBuyBlocked, estimateUnavailable }){
    return Boolean(policyValid && hasWallet && signingReady && !loading && !developerBuyBlocked && estimateUnavailable);
  }
  // app-source-end

  // app-source: 629
  function updateLaunchButton(){
    return appState.updateLaunchButtonView({ walletBalanceLamports: appState.walletBalanceLamports, estimatedLaunchFeeLamports: appState.estimatedLaunchFeeLamports, wallet: appState.wallet, launchCostReview: appState.launchCostReview, estimatedInitialBuyTokens: appState.estimatedInitialBuyTokens, LAUNCH_TOKEN_SUPPLY: appState.LAUNCH_TOKEN_SUPPLY, MIN_COMMUNITY_AIRDROP_TOKENS: appState.MIN_COMMUNITY_AIRDROP_TOKENS, MAX_COMMUNITY_AIRDROP_TOKENS: appState.MAX_COMMUNITY_AIRDROP_TOKENS, launchBurnReadiness: appState.launchBurnReadiness, xFeeStatus: appState.xFeeStatus, feeRouterState: appState.feeRouterState, walletMetricsLoading: appState.walletMetricsLoading, PROTOCOL_FUNDED_MINT: appState.PROTOCOL_FUNDED_MINT, APP_MAINNET_READ_ONLY: appState.APP_MAINNET_READ_ONLY }, { creatorBuyExceedsWalletBalance: appState.creatorBuyExceedsWalletBalance, getFeeDistributionInputs: appState.getFeeDistributionInputs, getLaunchBurnPolicy: appState.getLaunchBurnPolicy, getCreatorBuySol: appState.getCreatorBuySol, developerBuyLimitReached: appState.developerBuyLimitReached, getCommunityAirdropTokens: appState.getCommunityAirdropTokens, getLaunchStepState: appState.getLaunchStepState, launchEstimateRefreshAvailable: appState.launchEstimateRefreshAvailable, updateLaunchNavigation: appState.updateLaunchNavigation });
  }
  // app-source-end

  // app-source: 630
  function handleLaunchAction(event){
    if (event.currentTarget?.dataset.launchAction === 'connect-wallet') {
      void appState.connectWallet();
      return;
    }
    if (event.currentTarget?.dataset.launchAction === 'refresh-estimate') {
      void appState.refreshWalletInfo();
      return;
    }
    void appState.openLaunchReview();
  }
  // app-source-end

  // app-source: 632
  function currentLaunchReviewState(){
    return {
      reviewedCost: appState.launchCostReview,
      tierQuoteId: appState.currentLaunchTierQuote()?.id || null,
      tierBurnAmount: appState.getLaunchBurnPolicy().amountTokens,
      wallet: appState.connectedWalletAddress,
      router: appState.feeRouterState.address,
      form: JSON.stringify(appState.launchFormSnapshot()),
      image: appState.getPreparedImage(),
      feeConsent: document.querySelector('#fee-route-agree').checked,
      termsConsent: document.querySelector('#terms-agree').checked,
    };
  }
  // app-source-end

  // app-source: 633
  function renderPendingLaunchReview(){
    return appState.renderPendingLaunchReviewView({ pendingLaunchReview: appState.pendingLaunchReview }, { currentLaunchReviewState: appState.currentLaunchReviewState });
  }
  // app-source-end

  // app-source: 634
  async function openLaunchReview(){
    const reviewedCost = appState.launchCostReview;
    const session = appState.captureWalletSession();
    if (appState.launchStep !== 2 || !appState.getLaunchStepState(1).valid || !appState.getLaunchStepState(2).valid || !session || !appState.freshLaunchReview(reviewedCost) || document.querySelector('#launch-button')?.disabled) {
      appState.setLaunchStatus('Refresh the launch estimate and complete all checks before reviewing.', true);
      return;
    }
    appState.normalizeLaunchSocialField(document.querySelector('#token-x'));
    const name = document.querySelector('#token-name').value.trim();
    const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase();
    const shares = appState.getFeeDistributionInputs();
    let burn = appState.getLaunchBurnPolicy();
    const estimatedBurnAmount = burn.amountTokens;
    if (burn.requiresBurn) {
      try {
        const reusable = appState.currentLaunchTierQuote();
        const quote = reusable && Date.parse(reusable.expiresAt) - Date.now() > 120_000
          ? reusable
          : (await appState.apiRequest('/api/launch-tier-quote', { method:'POST', body:{ tier:burn.tier, payer:session.address } })).data;
        if (!appState.launchTierQuoteCurrent(quote, { tier:burn.tier, payer:session.address, mint:appState.PROTOCOL_FUNDED_MINT }))
          throw new Error('The paid tier quote could not be verified.');
        appState.assertWalletSessionCurrent(session);
        if (appState.launchBurnTier !== burn.tier) throw new Error('Launch tier changed while getting the quote. Review again.');
        appState.launchTierQuote = quote;
        burn = appState.getLaunchBurnPolicy();
        appState.renderLaunchBurnSelection();
        if (estimatedBurnAmount !== burn.amountTokens) {
          appState.launchCostReview = null;
          appState.launchBurnReadiness = { ready:false, message:'The $FUNDED price changed. Refresh the launch estimate, then review the new burn amount.' };
          await appState.refreshWalletInfo();
          appState.setLaunchStatus('The $FUNDED quote changed. Check the new amount and review the refreshed estimate.', true);
          return;
        }
      } catch (error) {
        appState.setLaunchStatus(String(error.message || 'The $FUNDED quote is unavailable.'), true);
        return;
      }
    }
    if (!appState.freshLaunchReview(reviewedCost) || !appState.isWalletSessionCurrent(session) || appState.launchCostReview !== reviewedCost) {
      appState.setLaunchStatus('Refresh the launch estimate and review again.', true);
      return;
    }
    appState.pendingLaunchReview = { ...appState.currentLaunchReviewState(), wallet: session.address };
    document.querySelector('#launch-review-token').textContent = `${name} (${symbol})`;
    document.querySelector('#launch-review-tier').textContent = burn.requiresBurn
      ? `${burn.label} · ${appState.formatLaunchBurnAmount(burn.amountTokens)} $FUNDED (≈$${burn.usdTarget})`
      : `${burn.label} tier`;
    document.querySelector('#launch-review-wallet').textContent = session.address;
    document.querySelector('#launch-review-reserve').textContent = `${appState.getCommunityAirdropTokens().toLocaleString()} tokens`;
    document.querySelector('#launch-review-buy').textContent = appState.getCreatorBuySol() ? `${appState.getCreatorBuySol()} SOL` : 'None';
    document.querySelector('#launch-review-route-short').textContent = `${appState.feeRouterState.address.slice(0, 7)}…${appState.feeRouterState.address.slice(-6)}`;
    document.querySelector('#launch-review-route-address').textContent = appState.feeRouterState.address;
    document.querySelector('#launch-review-route-split').textContent = `${shares.creatorWalletPercent}% wallet · ${shares.holderAirdropPercent}% holders · ${shares.solClaimPercent}% X · 20% protocol`;
    document.querySelector('#launch-review-details').innerHTML = appState.launchReviewMarkup(reviewedCost);
    document.querySelector('#launch-review-dialog').showModal();
    appState.renderPendingLaunchReview();
    appState.emitPilotSignal('launch-review-opened');
  }
  // app-source-end

  // app-source: 635
  function closeLaunchReview({ confirmed = false } = {}){
    if (appState.pendingLaunchReview && !confirmed) appState.emitPilotSignal('launch-review-cancelled');
    appState.pendingLaunchReview = null;
    document.querySelector('#launch-review-dialog')?.close();
  }
  // app-source-end

  // app-source: 636
  function confirmLaunchReview(){
    const pending = appState.pendingLaunchReview;
    appState.closeLaunchReview({ confirmed: true });
    if (!appState.launchReviewStillCurrent(pending, appState.currentLaunchReviewState())) {
      appState.setLaunchStatus('Launch review changed or expired. Refresh the estimate and review again; no transaction was sent.', true);
      return;
    }
    void appState.launchToken();
  }
  // app-source-end

  // app-source: 637
  function updateLaunchIdentityWarnings(){
    return appState.updateLaunchIdentityWarningsView({  }, {  });
  }
  // app-source-end

  // app-source: 638
  function getLaunchStepState(step){
    return appState.getLaunchStepStateView(step, { MIN_COMMUNITY_AIRDROP_TOKENS: appState.MIN_COMMUNITY_AIRDROP_TOKENS, MAX_COMMUNITY_AIRDROP_TOKENS: appState.MAX_COMMUNITY_AIRDROP_TOKENS, xFeeStatus: appState.xFeeStatus, launchMode: appState.launchMode }, { invalidLaunchSocial: appState.invalidLaunchSocial, getFeeDistributionInputs: appState.getFeeDistributionInputs, getCommunityAirdropTokens: appState.getCommunityAirdropTokens, getCreatorBuySol: appState.getCreatorBuySol, developerBuyLimitReached: appState.developerBuyLimitReached, xFeeFailureDetail: appState.xFeeFailureDetail, getLaunchBurnPolicy: appState.getLaunchBurnPolicy, formatLaunchBurnAmount: appState.formatLaunchBurnAmount });
  }
  // app-source-end

  // app-source: 639
  function getLaunchSubmissionState(){
    return appState.getLaunchSubmissionStateView({ feeRouterState: appState.feeRouterState, wallet: appState.wallet, walletMetricsLoading: appState.walletMetricsLoading, launchCostReview: appState.launchCostReview, walletBalanceLamports: appState.walletBalanceLamports, estimatedLaunchFeeLamports: appState.estimatedLaunchFeeLamports, walletEstimateError: appState.walletEstimateError, launchBurnReadiness: appState.launchBurnReadiness }, { creatorBuyExceedsWalletBalance: appState.creatorBuyExceedsWalletBalance, developerBuyLimitReached: appState.developerBuyLimitReached, getLaunchBurnPolicy: appState.getLaunchBurnPolicy });
  }
  // app-source-end

  // app-source: 640
  function updateLaunchNavigation(){
    return appState.updateLaunchNavigationView({ launchStep: appState.launchStep, feeRouterState: appState.feeRouterState, wallet: appState.wallet, estimatedLaunchFeeLamports: appState.estimatedLaunchFeeLamports, launchCostReview: appState.launchCostReview, walletMetricsLoading: appState.walletMetricsLoading }, { getLaunchStepState: appState.getLaunchStepState, getLaunchSubmissionState: appState.getLaunchSubmissionState, developerBuyLimitReached: appState.developerBuyLimitReached });
  }
  // app-source-end

  return { prepareLaunchMetadata, getFeeDistributionInputs, normalizeLaunchSocialField, launchSocialValue, validPublicUrl, invalidLaunchSocial, updateLaunchSocialValidity, launchEstimateRefreshAvailable, updateLaunchButton, handleLaunchAction, currentLaunchReviewState, renderPendingLaunchReview, openLaunchReview, closeLaunchReview, confirmLaunchReview, updateLaunchIdentityWarnings, getLaunchStepState, getLaunchSubmissionState, updateLaunchNavigation };
}
