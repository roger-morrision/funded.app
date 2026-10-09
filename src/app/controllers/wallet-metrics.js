// Dependencies and mutable application state are read live through appState.
export function createWalletMetricsController(appState) {
  // app-source: 645
  async function refreshWalletInfo({ rateLimitRetry = 0 } = {}){
    clearTimeout(appState.launchCostRefreshTimer);
    appState.launchCostRefreshTimer = null;
    if (!appState.wallet) { appState.setWalletMetrics(); return; }
    const session = appState.captureWalletSession();
    if (!session) { appState.setWalletMetrics(); return; }
    const payer = session.provider.publicKey;
    const request = ++appState.metricsRequest;
    const quoteStartedAt=Date.now();
    appState.setWalletMetrics({ loading: true });
    try {
      await appState.getSolana();
      const balance = await appState.connection.getBalance(payer, 'confirmed');
      if (request !== appState.metricsRequest || !appState.isWalletSessionCurrent(session)) return;
      appState.walletBalanceLamports = balance;
      appState.walletBalanceFetchedAt = Date.now();
      appState.renderWalletBalance();
      if (!appState.feeRouterState.verified || !appState.feeRouterState.address) throw new Error(appState.feeRouterState.status === 'router-verification-unavailable'
        ? 'Fee-router check could not reach Solana. Retry checks.'
        : 'Fee-router policy is not verified on Solana.');
      const creatorBuySol = appState.getCreatorBuySol();
      if (creatorBuySol > 0 && Math.ceil(creatorBuySol * 1_000_000_000) >= balance) throw new Error('Insufficient SOL for the developer buy and network costs. Reduce the buy amount or add SOL.');
      const [{ PUMP_SDK, OnlinePumpSdk }, { normalizeLaunchInput }, { getInitialBuyQuote, prepareFundedLaunchBurn }] = await Promise.all([import('@pump-fun/pump-sdk'), import('../../../launch-core.js'), import('../../../launch-flow.js')]);
      const { Keypair, PublicKey } = await appState.getSolana();
      const name = document.querySelector('#token-name').value.trim() || 'Solana Coin';
      const symbol = document.querySelector('#token-symbol').value.trim().toUpperCase() || 'COIN';
      const input = normalizeLaunchInput({ name, symbol, supply: appState.LAUNCH_TOKEN_SUPPLY, decimals: 6 });
      const reserveConfig = await appState.getLaunchReserveConfig();
      const developerBuy = await getInitialBuyQuote({ connection: appState.connection, input: { ...input, initialBuySol: appState.getCreatorBuySol() } });
      const initialBuy = await appState.quoteAtomicReserveBuy({ connection: appState.connection, supply:input.supply, decimals:input.decimals,
        reserveTokens:appState.getCommunityAirdropTokens(), developerBaseUnits:developerBuy.amountBaseUnits });
      initialBuy.curvePremiumBps = appState.initialCurvePremiumBps(initialBuy.amountBaseUnits, initialBuy.global.initialVirtualTokenReserves.toString());
      const mint = Keypair.generate();
      const xLinked = appState.getFeeDistributionInputs().solClaimPercent > 0;
      if (xLinked && !appState.xFeeStatus.ready) throw new Error('Mint-specific X fee claims are not ready on Solana.');
      const mintRouter = appState.buildMintRouterInitializeInstruction({ programId: appState.FEE_ROUTER_PROGRAM_ID, mint: mint.publicKey, payer });
      const router = mintRouter.router.address;
      const launchInstructions = initialBuy.amountBaseUnits > 0n
        ? await PUMP_SDK.createV2AndBuyInstructions({ global:initialBuy.global, mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, amount: new (await import('bn.js')).default(initialBuy.amountBaseUnits.toString()), solAmount: new (await import('bn.js')).default(initialBuy.solAmountLamports.toString()), mayhemMode: false, cashback: false, holderReward: false })
        : [await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: input.name, symbol: input.symbol, uri: `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`, creator: router, user: payer, mayhemMode: false, holderReward: false })];
      const launchBurn = appState.getLaunchBurnPolicy();
      const burnPlan = launchBurn.requiresBurn
        ? await prepareFundedLaunchBurn({ connection: appState.connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
        : null;
      const lookupTable = (await appState.connection.getAddressLookupTable(new PublicKey(reserveConfig.lookupTable), { commitment:'finalized' })).value;
      const reserve = appState.launchReserveInstructions({ mint:mint.publicKey, payer, programId:appState.FEE_ROUTER_PROGRAM_ID,
        authority:reserveConfig.authority, reserveTokens:appState.getCommunityAirdropTokens(), decimals:input.decimals });
      let plan;
      let estimates;
      for (let blockhashAttempt = 0; blockhashAttempt < 2; blockhashAttempt += 1) {
        // A finalized hash is visible across every backend in a load-balanced
        // Solana RPC pool. Retry once after the proxy cache window if a backend
        // still reports that it has not observed the hash.
        if (blockhashAttempt > 0) await new Promise(resolve => setTimeout(resolve, 1100));
        const latest = await appState.connection.getLatestBlockhash('finalized');
        plan = appState.buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions, burnInstruction: burnPlan?.instruction,
          mintRouterInstruction: mintRouter?.instruction, reserveInstructions:reserve.instructions, lookupTable });
        const estimateTransactions = plan.steps.map(step => step.transaction);
        try {
          // The split path still simulates every transaction; the legacy path is the original full launch simulation: connection.simulateTransaction(launchTransaction, undefined, [payer]).
          estimates = await Promise.all(estimateTransactions.map(async transaction => {
            const versioned = 'message' in transaction;
            const transactionFee = await appState.connection.getFeeForMessage(versioned ? transaction.message : transaction.compileMessage(), 'confirmed');
            if(transactionFee.value==null)throw new Error('Network fee quote is unavailable. Refresh before signing.');
            const transactionSimulation = versioned
              ? await appState.connection.simulateTransaction(transaction, { sigVerify:false, accounts:{ encoding:'base64', addresses:[payer.toBase58()] } })
              : await appState.connection.simulateTransaction(transaction, undefined, [payer]);
            if (transactionSimulation.value.err) {
              const reason = JSON.stringify(transactionSimulation.value.err);
              throw new Error(`The launch transaction could not be simulated on Solana: ${reason}.`);
            }
            const simulatedPayerBalance = transactionSimulation.value.accounts?.[0]?.lamports;
            const fee = Number(transactionFee.value);
            const estimatedSpend = balance - simulatedPayerBalance;
            if (!Number.isSafeInteger(simulatedPayerBalance) || !Number.isSafeInteger(fee) || !Number.isSafeInteger(estimatedSpend) || estimatedSpend < fee) throw new Error('The full Solana launch cost could not be verified.');
            return { fee, spend: estimatedSpend };
          }));
          break;
        } catch (error) {
          const blockhashMissing = /BlockhashNotFound|blockhash not found/i.test(String(error?.message || error));
          if (!blockhashMissing || blockhashAttempt > 0) throw error;
        }
      }
      if (!plan || !estimates) throw new Error('The Solana blockhash could not be refreshed for launch estimation.');
      const fee = estimates.reduce((total, item) => total + item.fee, 0);
      const estimatedSpend = estimates.reduce((total, item) => total + item.spend, 0);
      if (!Number.isSafeInteger(fee)
        || !Number.isSafeInteger(estimatedSpend) || estimatedSpend < fee) {
        throw new Error('The full Solana launch cost could not be verified.');
      }
      if (request !== appState.metricsRequest || !appState.isWalletSessionCurrent(session)) return;
      appState.launchBurnReadiness = burnPlan
        ? { ready: true, message: `Wallet verified for an atomic ${appState.formatLaunchBurnAmount(launchBurn.amountTokens)} $FUNDED burn with Pump creation${plan.mintRouterSeparate ? '; router initialization uses a separate approval' : ''}.` }
        : { ready: true, message: 'No creator-funded burn is required.' };
      appState.renderLaunchBurnSelection();
      const review=appState.launchReview({balance,simulatedSpend:estimatedSpend,networkFee:fee,buyQuote:initialBuy.solAmountLamports,buyMaximum:initialBuy.maxSolAmountLamports,transactionCount:plan.steps.length,curvePremiumBps:initialBuy.curvePremiumBps,now:quoteStartedAt});
      if(!appState.freshLaunchReview(review))throw new Error('Estimate took too long and expired. Refresh before signing.');
      appState.launchCostReview=review;
      appState.estimatedInitialBuyLamports=Number(initialBuy.solAmountLamports);
      appState.estimatedInitialBuyTokens=Number(developerBuy.amountTokens);
      appState.updateLaunchPreview();
      appState.setWalletMetrics({ balance, fee: Number(appState.launchCostReview.budget) });
    } catch (error) {
      if (request === appState.metricsRequest && appState.isWalletSessionCurrent(session)) {
        const rawReason = String(error?.message || 'The exact Solana launch cost could not be verified.');
        const rateLimited = /\b429\b|rate limit|too many requests/i.test(rawReason);
        if (rateLimited && rateLimitRetry < 2) {
          await new Promise(resolve => setTimeout(resolve, (rateLimitRetry + 1) * 2_000));
          if (request === appState.metricsRequest && appState.isWalletSessionCurrent(session)) return appState.refreshWalletInfo({ rateLimitRetry: rateLimitRetry + 1 });
          return;
        }
        // Invalid form input is an expected validation state, not a runtime failure.
        const expectedInputError = [
          'Token name must be 1–32 characters.',
          'Ticker must contain 1–10 letters or numbers.',
          'Initial supply must be a positive whole number.',
          'Decimals must be an integer from 0 to 9.',
        ].includes(rawReason) || appState.developerBuyLimitReached(rawReason);
        if (!expectedInputError) console.warn('Launch cost estimate failed:', error);
        const reason = rateLimited
          ? 'Solana RPC is rate limited. Wait a moment, then refresh the estimate.'
          : rawReason.slice(0, 180);
        const launchBurn = appState.getLaunchBurnPolicy();
        if (launchBurn.requiresBurn) {
          appState.launchBurnReadiness = { ready: false, message: error?.message || 'The $FUNDED burn could not be prepared.' };
          appState.renderLaunchBurnSelection();
        }
        try {
          await appState.getSolana();
          const balance = await appState.connection.getBalance(payer, 'confirmed');
          if (request === appState.metricsRequest && appState.isWalletSessionCurrent(session)) appState.setWalletMetrics({ balance, fee: null, error: reason });
        } catch {
          if (request === appState.metricsRequest && appState.isWalletSessionCurrent(session)) appState.setWalletMetrics({ balance: null, fee: null, error: reason });
        }
      }
    }
  }
  // app-source-end

  // app-source: 646
  function scheduleLaunchCostRefresh(){
    if (!appState.wallet) return;
    appState.metricsRequest += 1;
    clearTimeout(appState.launchCostRefreshTimer);
    appState.setWalletMetrics({ loading: true });
    appState.launchCostRefreshTimer = setTimeout(() => { appState.launchCostRefreshTimer = null; appState.refreshWalletInfo(); }, 350);
  }
  // app-source-end

  return { refreshWalletInfo, scheduleLaunchCostRefresh };
}
