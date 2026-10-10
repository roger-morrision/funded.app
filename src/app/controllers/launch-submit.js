// Dependencies and mutable application state are read live through appState.
export function createLaunchSubmitController(appState) {
  // app-source: 662
  async function launchToken(){
    if (appState.APP_CLUSTER !== 'devnet') {
      appState.setLaunchStatus('Coin launching is unavailable in this workspace.', true);
      return;
    }
    if (!appState.wallet) { await appState.connectWallet(); if (!appState.wallet) return; }
    const session = appState.captureWalletSession();
    if (!session || !appState.canSignTransactions(session.provider)) { appState.setLaunchStatus('Open this app inside a signing wallet to launch.', true); return; }
    const name = document.querySelector('#token-name').value.trim(); const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase(); const supply = Number(document.querySelector('#token-supply').value); const decimals = Number(document.querySelector('#token-decimals').value);
    const metadataPreview = appState.getLaunchMetadataPreview();
    const communityTokens = appState.getCommunityAirdropTokens();
    const communityAllocation = appState.getCommunityAllocationPercent();
    const xRecipient = appState.normalizeXHandle(document.querySelector('#x-recipient').value);
    const fundedMint = appState.getFundedMintAddress();
    const launchBurn = appState.getLaunchBurnPolicy();
    const launchBurnValidation = appState.validateLaunchBurnPolicy(launchBurn);
    const feeDistributionInput = appState.getFeeDistributionInputs();
    const feeDistribution = appState.validateFeeDistribution(feeDistributionInput);
    if (!document.querySelector('#fee-route-agree').checked) { appState.setLaunchStatus('Confirm the funded.vip creator-fee route before launching.', true); return; }
    if (!document.querySelector('#terms-agree').checked) { appState.setLaunchStatus('Agree to the Terms of Use before launching.', true); return; }
    if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol) || !Number.isFinite(supply) || supply < 1 || decimals < 0 || decimals > 9) { appState.setLaunchStatus('Enter a valid name and a 1–10 character ticker using letters or numbers.', true); return; }
    const invalidSocial = appState.invalidLaunchSocial();
    if (invalidSocial) { const details = invalidSocial.closest('details'); if (details) details.open = true; invalidSocial.reportValidity(); appState.setLaunchStatus(invalidSocial.validationMessage, true); return; }
    if (!Number.isSafeInteger(communityTokens) || communityTokens < appState.MIN_COMMUNITY_AIRDROP_TOKENS || communityTokens > appState.MAX_COMMUNITY_AIRDROP_TOKENS || !Number.isFinite(communityAllocation)) { appState.setLaunchStatus('Community airdrop must be between 30,000,000 and 500,000,000 tokens.', true); return; }
     if (feeDistributionInput.solClaimPercent > 0 && !/^@[A-Za-z0-9_]{1,15}$/.test(xRecipient)) { appState.setLaunchStatus('Enter a valid X handle such as @account when X account rewards are above 0%.', true); return; }
    if (feeDistributionInput.solClaimPercent > 0 && !appState.xFeeStatus.ready) { appState.setLaunchStatus(`X account rewards unavailable: ${appState.xFeeFailureDetail()}.`, true); return; }
    if (!feeDistribution.valid) { appState.setLaunchStatus('Creator fee shares must total exactly 80%. Check the wallet, holder, and X percentages.', true); return; }
    if (!launchBurnValidation.valid) { appState.setLaunchStatus('The fixed $FUNDED mint must be configured before a paid launch tier can be used.', true); return; }
    if (launchBurn.requiresBurn && (!appState.currentLaunchTierQuote() || launchBurn.quoteId !== appState.currentLaunchTierQuote().id)) {
      appState.setLaunchStatus('The $FUNDED tier quote expired or changed. Review the launch again.', true); return;
    }
    if (launchBurn.requiresBurn && !appState.launchBurnReadiness.ready) { appState.setLaunchStatus(appState.launchBurnReadiness.message, true); return; }
    if (!appState.feeRouterState.verified || !appState.feeRouterState.address) { appState.setLaunchStatus('Launch blocked until the funded.vip fee-router PDA is deployed and verified on Solana.', true); return; }
    const reviewedCost=appState.launchCostReview;
    if(!appState.freshLaunchReview(reviewedCost)){appState.setLaunchStatus('Estimate expired. Refresh the launch estimate before signing.',true);return;}
    if (appState.walletBalanceLamports == null || appState.estimatedLaunchFeeLamports == null) { appState.setLaunchStatus('Wallet balance and launch cost could not be verified. Refresh the estimate before signing.', true); return; }
    if (appState.walletBalanceLamports != null && appState.estimatedLaunchFeeLamports != null && appState.walletBalanceLamports < appState.estimatedLaunchFeeLamports) { appState.setLaunchStatus('Insufficient SOL for this launch. Fund the wallet, then refresh the balance and fee estimate before signing.', true); return; }
    document.querySelector('#launch-button').disabled = true;
    appState.launchSubmitting = true;
    let journalId, pilotLaunchVerified = false;
    try {
      const [{ submitPumpDevnetLaunch }, { devnetExplorer }] = await Promise.all([import('../../../launch-flow.js'), import('../../../launch-core.js')]);
      appState.assertWalletSessionCurrent(session);
      const pendingReferral = appState.getAppReferralAttribution();
      if (pendingReferral?.wallet === session.address && !pendingReferral.serverVerified) {
        appState.setLaunchStatus('Verifying your invite before launch…');
        await appState.syncServerReferralState({ register: false });
        appState.assertWalletSessionCurrent(session);
      }
      const creatorBuySol = appState.getCreatorBuySol();
      if (!Number.isFinite(creatorBuySol) || creatorBuySol < 0) { appState.setLaunchStatus('Developer buy must be a valid SOL amount of zero or more.', true); return; }
      const xLinked = feeDistributionInput.solClaimPercent > 0;
      let xUserId = null;
      if (xLinked) {
        appState.setLaunchStatus('Resolving the X account to its stable user ID before signing…');
        const resolved = await appState.apiRequest(`/api/x/resolve?handle=${encodeURIComponent(xRecipient)}`);
        appState.assertWalletSessionCurrent(session);
        if (!resolved.available || !/^\d{1,24}$/.test(String(resolved.data?.id || '')) || resolved.data.handle.toLowerCase() !== xRecipient.toLowerCase()) throw new Error('X account identity could not be verified before launch. No coin transaction was sent.');
        xUserId = resolved.data.id;
      }
      const unresolved=appState.readLaunchJournal().find(row=>row.payer===session.address&&row.name===name&&row.symbol===symbol&&['broadcasting','submitted','unknown','confirmed','verification-pending','registration-pending'].includes(row.state));
      if(unresolved)throw new Error('An earlier launch with this name and ticker needs recovery in Portfolio. Check its receipts before creating another coin.');
      if(!appState.freshLaunchReview(reviewedCost))throw new Error('Estimate expired during identity lookup. Refresh and review again before signing.');
      if (launchBurn.requiresBurn && (!appState.currentLaunchTierQuote() || launchBurn.quoteId !== appState.currentLaunchTierQuote().id || launchBurn.amountTokens !== appState.currentLaunchTierQuote().amountTokens))
        throw new Error('The $FUNDED tier quote expired before signing. Review the launch again.');
      const reserveConfig = await appState.getLaunchReserveConfig();
      appState.assertWalletSessionCurrent(session);
      if (launchBurn.requiresBurn && (!appState.currentLaunchTierQuote() || launchBurn.quoteId !== appState.currentLaunchTierQuote().id))
        throw new Error('The $FUNDED tier quote expired before signing. Review the launch again.');
      journalId=crypto.randomUUID();appState.recordLaunchEvent(journalId,{state:'prepared',name,symbol,payer:session.address,cluster:'devnet'});
      appState.emitPilotSignal('launch-submission-started');
      const result = await submitPumpDevnetLaunch({ cluster: appState.APP_CLUSTER, connection: appState.connection, provider: session.provider, payer: session.provider.publicKey, input: { name, symbol, supply, decimals, initialBuySol: creatorBuySol, reserveTokens:communityTokens, maxInitialBuyLamports:reviewedCost.buyMaximum }, prepareMetadata: input => appState.prepareLaunchMetadata(input, session), feeRouterAddress: appState.feeRouterState.address, feeRouterProgramId: appState.FEE_ROUTER_PROGRAM_ID, useMintRouter: true, launchBurn, reserveConfig, assertWalletCurrent: () => appState.assertWalletSessionCurrent(session), onJournal:event=>appState.recordLaunchEvent(journalId,event), onStatus: message => { if (appState.isWalletSessionCurrent(session)) appState.setLaunchStatus(message); } });
      const routeAddress = result.feeRouter.toBase58();
      const routeState = { ...appState.feeRouterState, ...appState.deriveMintFeeRouter(appState.FEE_ROUTER_PROGRAM_ID, result.mint.publicKey), address: routeAddress, scope: 'per-mint-v2' };
      const launchPolicy = {
        chain: 'solana',
        cluster: 'devnet',
        launchpad: 'pump',
        mint: result.mint.publicKey.toBase58(),
        creatorWallet: session.address,
        name: result.name,
        symbol: result.symbol,
        metadataUri: result.metadataUri,
        metadataPreview,
        supply,
        decimals,
        initialBuy: result.initialBuy ? { percent: result.initialBuy.percent, amountTokens: result.initialBuy.amountTokens, developerAmountTokens:result.initialBuy.developerAmountTokens,
          amountBaseUnits: result.initialBuy.amountBaseUnits.toString(), solAmountLamports: result.initialBuy.solAmountLamports.toString() } : null,
        communityAllocation,
        communityAirdrop: appState.fundedCommunityAirdropPolicy({ allocationPercent: communityAllocation, supply, receipt:result.reserveReceipt }),
        launchReserve: { ...appState.buildLaunchReservePlan({ allocationPercent: communityAllocation, supply, mintAddress: result.mint.publicKey.toBase58() }),
          atomic:true, instructions:['Pump createV2', 'Pump buy', 'Create vault token account', 'TransferChecked'],
          onChainStatus:'funded', fundingSignature:result.signature, vault:result.reserveReceipt.vault },
        reserveReceipt:result.reserveReceipt,
        revenueBuyback: appState.buildBuybackPolicy({ fundedMint: fundedMint || null }),
        creatorLaunchBurn: {
          ...launchBurn,
          status: result.launchBurnReceipt ? 'verified' : 'not-required',
          receipt: result.launchBurnReceipt,
        },
        fundedTokenMint: fundedMint || null,
        feeRouter: appState.buildFeeRouterPolicy(routeState),
        feeDistribution: appState.buildFeeDistributionPolicy({ ...feeDistributionInput, feeRouterAddress: routeAddress }),
        ...(xLinked ? { xUserId } : {}),
         solClaim: appState.buildSolClaimPolicy({ handle: xRecipient, percent: feeDistributionInput.solClaimPercent, feeRouterAddress: routeAddress }),
        revenueModel: {
          fundedPercentOfCreatorFees: appState.APP_ECONOMICS.fundedSharePercent,
          creatorConfigurablePercent: appState.APP_ECONOMICS.creatorSharePercent,
          operationsPercentOfFundedRevenue: appState.APP_ECONOMICS.operationsRateOfFundedRevenue,
          operationsEffectivePercentOfCreatorFees: appState.APP_ECONOMICS.operationsEffectivePercent,
          referralNetworkPercentOfFundedRevenue: appState.APP_ECONOMICS.appReferralRateOfFundedRevenue,
          referralNetworkEffectivePercentOfCreatorFees: appState.APP_ECONOMICS.appReferralEffectivePercent,
          referralLevels: appState.APP_ECONOMICS.appReferralLevels,
          communityPercentOfFundedRevenue: appState.APP_ECONOMICS.communityRateOfFundedRevenue,
          communityEffectivePercentOfCreatorFees: appState.APP_ECONOMICS.communityEffectivePercent,
          buybackPercentOfFundedRevenue: appState.APP_ECONOMICS.buybackRateOfFundedRevenue,
          buybackEffectivePercentOfCreatorFees: appState.APP_ECONOMICS.buybackEffectivePercent,
          status: 'pump-route-verified-settlement-program-required',
        },
        pumpFeeRoute: {
          percent: 100,
          router: routeAddress,
          scope: 'per-mint-v2',
          pumpCreator: result.feeRoute.creator,
          userHasCreatorFeeAuthority: result.feeRoute.userHasCreatorFeeAuthority,
          verified: result.feeRoute.verified,
          transaction: result.signature,
        },
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(`funded.launch.${launchPolicy.mint}`, JSON.stringify(launchPolicy));
      if (appState.isWalletSessionCurrent(session)) appState.renderCreatorLaunches();
      let persistedLaunch = { available: false };
      appState.recordLaunchEvent(journalId,{state:'registration-pending',signature:result.signature});
      try {
        appState.assertWalletSessionCurrent(session);
        if (typeof session.provider.signMessage !== 'function') throw new Error('Wallet message signing is required to register the immutable launch policy.');
        const policySignature = await session.provider.signMessage(new TextEncoder().encode(appState.launchPolicyStatement(launchPolicy)));
        appState.assertWalletSessionCurrent(session);
        launchPolicy.policySignature = appState.bs58.encode(policySignature.signature || policySignature);
        localStorage.setItem(`funded.launch.${launchPolicy.mint}`, JSON.stringify(launchPolicy));
        persistedLaunch = await appState.persistLaunchPolicy(launchPolicy);
        pilotLaunchVerified = appState.verifiedPilotLaunchRegistration(persistedLaunch, launchPolicy.mint);
        if (pilotLaunchVerified) appState.emitPilotSignal('launch-confirmed');
        if(persistedLaunch.available){
          appState.recordLaunchEvent(journalId,{state:'completed'});
          localStorage.removeItem(`funded.launch.${launchPolicy.mint}`);
        }
      } catch (policyError) {
        if (appState.isWalletSessionCurrent(session)) appState.setLaunchStatus(`Coin confirmed on Solana, but policy registration is pending: ${policyError.message}`, true);
      }
      if (!appState.verifiedPilotLaunchRegistration(persistedLaunch, launchPolicy.mint)) appState.emitPilotSignal('launch-registration-pending');
      const tradeMint = document.querySelector('#trade-mint');
      if (tradeMint) tradeMint.value = launchPolicy.mint;
      if (persistedLaunch.available) await appState.loadOnchainExploreData(); else appState.renderRegistry();
      if (persistedLaunch.available) await appState.loadVerifiedLaunchPolicies();
      if (appState.isWalletSessionCurrent(session)) appState.updateOnboardingProgress();
      if (!appState.isWalletSessionCurrent(session)) { appState.showToast(`${result.symbol} launched from ${session.address.slice(0, 4)}… while wallet account changed. Check your launch history.`); return; }
      const burnReceipt = result.launchBurnReceipt;
      const burnSummary = burnReceipt
        ? ` · ${appState.formatLaunchBurnAmount(burnReceipt.amountTokens)} $FUNDED burned ${burnReceipt.atomicWithPumpLaunch ? 'atomically' : 'in a separately confirmed transaction'}`
        : '';
      const launchLinks = [
        { label: burnReceipt?.atomicWithPumpLaunch ? 'Verify launch and burn on Explorer ↗' : 'Verify fee owner on Explorer ↗', href: devnetExplorer(`tx/${result.signature}`) },
        ...(burnReceipt && !burnReceipt.atomicWithPumpLaunch ? [{ label: 'Verify separate $FUNDED burn on Explorer ↗', href: devnetExplorer(`tx/${burnReceipt.signature}`) }] : []),
        { label: 'View mint on Explorer ↗', href: devnetExplorer(`address/${result.mint.publicKey.toBase58()}`) },
        { label: 'Open My launches →', href: '#my-launches' },
        { label: 'Publish community airdrop →', href: '#airdrops' },
      ];
      appState.setLaunchLinks(`Launch verified ✓\n${result.name} (${result.symbol}) is confirmed on Solana.\nMint: ${result.mint.publicKey.toBase58()}\nLaunch tier: ${launchBurn.label}${burnSummary}\nPump creator-fee owner: funded.vip router\nYour wallet has no creator-fee authority.\nCommunity reserve funded: ${communityAllocation}% (${launchPolicy.communityAirdrop.reservedTokens.toLocaleString()} tokens)\nReward vault: ${result.reserveReceipt.vault}\nClaims open after a verified migration snapshot.\nSettlement policy: 80% creator-directed / 20% app protocol${feeDistributionInput.solClaimPercent > 0 ? `\nSOL claim recipient: ${xRecipient}` : ''}`, launchLinks);
      document.querySelector('#launch-status').classList.add('launch-complete');
      appState.showToast(persistedLaunch.available ? `${result.symbol} launched and listed in Explore` : `${result.symbol} launched on-chain; Explore listing is pending API verification`); appState.renderAirdropClaims(); appState.refreshWalletBalance(); appState.openLaunchedCoinPage(launchPolicy);
    } catch (error) {
      let saved=appState.readLaunchJournal().find(row=>row.id===journalId);
      if(journalId&&saved?.state==='prepared')saved=appState.recordLaunchEvent(journalId,{state:'failed',message:error.message});
      const needsRecovery=Boolean(saved&&(saved.signature||saved.events?.some(event=>event.signature||['broadcasting','submitted','confirmed','verification-pending','registration-pending','unknown'].includes(event.state))));
      if (!pilotLaunchVerified) appState.emitPilotSignal(appState.pilotInterruptedSignal('launch', error, needsRecovery));
      if (appState.isWalletSessionCurrent(session)) {
        const message = `Launch stopped: ${error.message}${needsRecovery ? ' A transaction may have reached Solana. Check its receipt before attempting another launch.' : ' No transaction was sent; correct the issue and retry.'}`;
        if (needsRecovery && saved?.signature) {
          appState.setLaunchLinks(message, [{ label: 'Check transaction on Solana Explorer ↗', href: appState.exploreExplorer(`tx/${encodeURIComponent(saved.signature)}`) }], true);
        } else appState.setLaunchStatus(message, true);
      }
    } finally { appState.launchSubmitting = false; appState.updateLaunchButton(); }
  }
  // app-source-end

  return { launchToken };
}
