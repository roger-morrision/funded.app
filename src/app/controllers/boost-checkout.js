import {pricedBoostPackages} from '../../../boost-pricing.js';
import {currentBoostSnapshot} from '../../../boost-offer.js';
import {snapshotBoostPayment,assertBoostWalletPayment,MAX_BOOST_NETWORK_FEE_LAMPORTS} from '../../../boost-wallet-review.js';
// Dependencies and mutable application state are read live through appState.
export function createBoostCheckoutController(appState) {
  let livePackages=null, pricingRevision=null;
  function restorePendingBoost(mint,payer) {
    if (!payer) return false;
    const pending=appState.readPendingBoost(mint,undefined,{payer,cluster:'devnet'});
    if (!pending) return false;
    Object.assign(appState.boostCheckout,{packageId:pending.quote.packageId,quote:pending.quote,
      pendingSignature:pending.signature,blockhash:pending.blockhash,signedTransaction:pending.signedTransaction,
      message:'Your previous payment is awaiting confirmation. Check it before paying again.'});
    return true;
  }
  // app-source: 283
  function exploreBoostStatus(mint){
    const multiplier = appState.activeBoostMultiplier(appState.verifiedBoosts[mint]);
    if (multiplier) return `Sponsored · ${multiplier.toLocaleString()}x`;
    return '';
  }
  // app-source-end

  // app-source: 284
  function exploreBoostAmountMarkup(mint){
    return appState.boostPackageBadgesMarkup(appState.verifiedBoosts[mint]);
  }
  // app-source-end

  // app-source: 285
  function exploreTierBadgeMarkup(mint){
    const promotion = appState.promotionForMint(mint);
    const info = `<button type="button" class="explore-tier-info" data-tier-info-mint="${appState.escapeHtml(mint)}" aria-label="Explain launch tier for ${appState.escapeHtml(appState.shortAddress(mint))}" title="Explain this launch tier">${appState.icon('info')}</button>`;
    if (promotion) return `<span class="scanner-tier-wrap"><a class="explore-tier-badge" data-tier="${appState.escapeHtml(promotion.tier)}" href="${appState.escapeHtml(appState.exploreExplorer(`tx/${encodeURIComponent(promotion.signature)}`))}" target="_blank" rel="noopener noreferrer" title="${appState.escapeHtml(`${promotion.amountTokens.toLocaleString()} $RICH burned with the verified launch · view receipt`)}">${appState.escapeHtml(promotion.tier.charAt(0).toUpperCase() + promotion.tier.slice(1))}</a>${info}</span>`;
    const verified = Boolean(appState.verifiedLaunchPolicyForMint(mint));
    return `<span class="scanner-tier-wrap"><span class="explore-tier-badge" data-tier="${verified ? 'standard' : 'unavailable'}" title="${verified ? 'Verified launch policy · no paid promotion burn' : 'Launch tier unavailable without a verified policy'}">${verified ? 'Standard' : 'Unavailable'}</span>${info}</span>`;
  }
  // app-source-end

  // app-source: 286
  function openExploreTierInfo(mint){
    const asset = appState.assets.find(item => item.address === mint);
    const dialog = document.querySelector('#explore-tier-dialog');
    const details = document.querySelector('#explore-tier-details');
    if (!asset || !dialog || !details) return;
    const policy = appState.verifiedLaunchPolicyForMint(mint);
    const promotion = appState.promotionForMint(mint);
    const symbol = appState.escapeHtml(asset.symbol || appState.shortAddress(mint));
    document.querySelector('#explore-tier-title').textContent = `${asset.symbol || 'Token'} · launch tier`;
    if (!policy) {
      details.innerHTML = `<p class="explore-tier-summary">${symbol} has no verified launch policy in this feed. Its tier and reward allocation are unavailable.</p><a class="explore-tier-detail-link" href="/token/${encodeURIComponent(mint)}">Open token record ↗</a>`;
    } else {
      const allocation = appState.verifiedPolicyPercent(policy.communityAirdrop?.allocationPercent);
      const airdrop = allocation == null ? 'Unavailable' : appState.formatVerifiedPercent(allocation);
      const tier = promotion ? promotion.tier.charAt(0).toUpperCase() + promotion.tier.slice(1) : 'Standard';
      details.innerHTML = `<div class="explore-tier-fact"><span>Verified launch tier</span><strong>${appState.escapeHtml(tier)}</strong><small>${promotion ? `${appState.escapeHtml(Number(promotion.amountTokens).toLocaleString())} $RICH burned in the confirmed launch transaction` : 'No verified paid promotion burn'}</small></div>
        <div class="explore-tier-fact"><span>Community allocation</span><strong>${appState.escapeHtml(airdrop)}</strong><small>Share of token supply in the launch policy; vault funding and distribution require separate verification.</small></div>
        ${promotion ? `<a class="explore-tier-detail-link" href="${appState.escapeHtml(appState.exploreExplorer(`tx/${encodeURIComponent(promotion.signature)}`))}" target="_blank" rel="noopener noreferrer">View burn receipt ↗</a>` : ''}
        <a class="explore-tier-detail-link" href="/token/${encodeURIComponent(mint)}">Open token record ↗</a>`;
    }
    if (!dialog.open) dialog.showModal();
  }
  // app-source-end

  // app-source: 287
  function exploreAirdropMarkup(record){
    if (record.communityAirdropPercent == null) return '<span class="scanner-airdrop scanner-airdrop--unavailable" title="No verified launch allocation is available"><strong>—</strong><small>Details unavailable</small></span>';
    const policy = appState.verifiedLaunchPolicyForMint(record.address);
    const reserve = appState.verifiedCommunityReserves.get(record.address);
    const funded = appState.communityReserveStatus === 'ready' && reserve?.verified === true && ['funded', 'drop-active'].includes(reserve.status)
      && Number(reserve.reservedTokens) === Number(policy?.communityAirdrop?.reservedTokens);
    const active = funded && reserve.status === 'drop-active';
    const detail = active ? 'Claims open' : funded ? 'Upcoming' : 'Checking availability';
    const percent = appState.formatVerifiedPercent(record.communityAirdropPercent);
    const status = active ? 'Reserve vault funded and drop active; check wallet eligibility and claim proof separately.'
      : funded ? 'Reserve vault funding verified; eligibility and distribution remain pending.'
        : 'Reserve vault funding and distribution are not verified.';
    return `<a class="scanner-airdrop" href="#airdrops" title="${appState.escapeHtml(`${percent} of token supply in the verified launch policy. ${status}`)}"><strong>${appState.escapeHtml(percent)}</strong><small>${detail}</small></a>`;
  }
  // app-source-end

  // app-source: 288
  function boostAssetForMint(mint){
    const known = appState.assets.find(item => item.address === mint);
    if (known || appState.getCoinMintAddress() !== mint) return known || null;
    const symbol = document.querySelector('#coin-symbol')?.textContent?.trim() || '';
    const name = document.querySelector('#coin-page-title')?.textContent?.trim() || '';
    return { address:mint,
      symbol: /^(?:on-chain|loading.*|unavailable|—|–)$/i.test(symbol) ? appState.shortAddress(mint) : symbol || appState.shortAddress(mint),
      name: /^(?:loading token.*|token.*unavailable|—|–)$/i.test(name) ? appState.shortAddress(mint) : name || appState.shortAddress(mint) };
  }
  // app-source-end

  // app-source: 289
  function openExploreBoost(mint){
    if (appState.boostCheckout.busy) { appState.showToast('Finish the current boost payment or verification before opening another checkout.'); return; }
    const asset = appState.boostAssetForMint(mint);
    const dialog = document.querySelector('#explore-boost-dialog');
    if (!asset || !dialog) return;
    appState.boostCheckout = { mint, packageId:'10x', quote:null, pendingSignature:null, busy:false, message:'' };
    livePackages=null;pricingRevision=null;
    try {
      restorePendingBoost(mint,appState.connectedWalletAddress);
    } catch (error) { appState.boostCheckout.recoveryError = error.message || 'Saved payment details are unavailable. Check device storage before paying again.'; }
    appState.exploreBoostHistory = [];
    appState.exploreBoostHistoryState = 'loading';
    appState.renderExploreBoostDialog();
    if (!dialog.open) dialog.showModal();
    void appState.loadExploreBoostHistory(mint);
    appState.productEvent('boost_open');
  }
  // app-source-end

  // app-source: 292
  async function loadExploreBoostHistory(mint){
    const response = await appState.apiRequest(`/api/boosts?mint=${encodeURIComponent(mint)}`).catch(() => ({ available:false }));
    if (appState.boostCheckout.mint !== mint) return;
    if (!response.available || !Array.isArray(response.data?.history)) {
      appState.exploreBoostHistoryState = 'unavailable'; appState.renderExploreBoostDialog(); return;
    }
    appState.exploreBoostHistoryState = 'ready';
    try{
      if(!Number.isSafeInteger(response.data.pricingRevision)||response.data.pricingRevision<0)throw Error('Invalid pricing revision');
      livePackages=pricedBoostPackages(Object.fromEntries(response.data.packages.map(pack=>[pack.id,Math.round(pack.usd*100)])));
      pricingRevision=response.data.pricingRevision;
    }
    catch{livePackages=null;appState.exploreBoostHistoryState='unavailable';}
    appState.exploreBoostHistory = response.data.history;
    if (appState.boostCheckout.pendingSignature && !appState.boostCheckout.busy) {
      try {
        if (appState.archiveVerifiedBoostFromHistory(appState.boostCheckout, appState.exploreBoostHistory)) {
          appState.boostCheckout.pendingSignature = null;
          appState.boostCheckout.quote = null;
          appState.boostCheckout.message = 'Payment confirmed. You can buy another boost.';
        }
      } catch (error) {
        appState.boostCheckout.recoveryError = error.message || 'Saved payment recovery could not be completed. Retry the original payment before paying again.';
      }
    }
    if (response.data.active?.[mint]) appState.verifiedBoosts[mint] = response.data.active[mint];
    else delete appState.verifiedBoosts[mint];
    appState.scheduleBoostExpiryRefresh();
    appState.renderExploreBoostDialog();
  }
  // app-source-end

  // app-source: 293
  function renderExploreBoostDialog(){
    const { mint, packageId, quote, pendingSignature, busy, message, failureProof, recoveryError } = appState.boostCheckout;
    const asset = appState.boostAssetForMint(mint);
    const details = document.querySelector('#explore-boost-details');
    if (!asset || !details) return;
    const name = appState.escapeHtml(asset.name || asset.symbol || appState.shortAddress(mint));
    document.querySelector('#explore-boost-title').textContent = `Boost ${asset.symbol || asset.name || 'token'}`;
    const active = currentBoostSnapshot(appState.verifiedBoosts)[mint];
    const packages=livePackages||appState.BOOST_PACKAGES;
    const selected = packages.find(pack=>pack.id===packageId)||appState.boostPackage(packageId);
    const available = !recoveryError && ((livePackages && appState.EXPLORE_CLUSTER === 'devnet' && !appState.APP_MAINNET_READ_ONLY && appState.boostPurchasesEnabled) || Boolean(pendingSignature));
    const quotedAmount = quote && quote.mint === mint && quote.packageId === packageId && Date.parse(quote.expiresAt) > Date.now()
      ? (quote.lamports / 1e9).toFixed(9) : null;
    const historyRows = appState.boostHistoryRows(appState.exploreBoostHistory, appState.boostCheckout, mint);
    const historyOpen = pendingSignature || details.querySelector('.explore-boost-history')?.open;
    const advancedOpen = details.querySelector('.explore-boost-how')?.open;
    details.innerHTML = `<p class="explore-boost-intro">Boost ${name}: each new purchase adds its quantity and hours to the active boost.</p>
      <div class="explore-boost-packages" role="group" aria-label="Boost packages">${packages.map(item => `<button type="button" data-boost-package="${item.id}" aria-pressed="${item.id === packageId}" ${busy || pendingSignature ? 'disabled' : ''}><strong><span class="boost-leading-icon">${appState.icon('boost')}</span>${item.id}</strong><small>${item.hours} hours</small><b>$${item.usd.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b><small>${Number.isFinite(appState.coinSolUsdPrice) && appState.coinSolUsdPrice > 0 ? `≈ ${(item.usd / appState.coinSolUsdPrice).toFixed(4)} SOL` : 'Paid in SOL'}</small></button>`).join('')}</div>
      <div class="explore-boost-current"><span>Active boosts</span><strong>${appState.verifiedBoostsAvailable ? (active ? `${appState.escapeHtml(active.multiplier)}x${active.golden ? ' · golden ticker' : ''}` : 'None') : 'Unavailable'}</strong>${active ? `<small>${active.count} purchase${active.count === 1 ? '' : 's'} · latest expiry ${appState.escapeHtml(new Date(active.expiresAt).toLocaleString())}</small>` : ''}</div>
      <p class="explore-boost-explainer">Pay in Solana Devnet test SOL. Network fee is additional, up to 0.001 SOL. Test SOL has no monetary value.</p>
      ${quotedAmount ? `<div class="explore-boost-quote"><strong>Review your payment</strong><span>${quotedAmount} SOL</span><small>$${quote.usd.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} package · $${quote.solUsd}/SOL</small><small>To ${appState.escapeHtml(quote.recipient)}</small>${appState.quoteCountdownMarkup(quote.expiresAt)}</div>` : quote && !pendingSignature ? '<p class="explore-boost-quote-expired">This price expired. Get an updated price before paying.</p>' : ''}
      <button type="button" class="primary-button explore-boost-pay" ${!available || busy ? 'disabled' : ''}><span class="boost-leading-icon">${appState.icon('boost')}</span>${busy ? 'Checking payment…' : failureProof ? 'Start a new purchase' : pendingSignature ? 'Check payment status' : quotedAmount ? `Pay ${quotedAmount} SOL · ${selected.id}` : `${quote ? 'Refresh price' : active ? 'Buy another boost' : 'Continue'} · ${selected.id} · $${selected.usd.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}</button>
      <p class="explore-boost-message" role="status">${appState.escapeHtml(recoveryError || message || (available ? 'Review the exact SOL amount before approving in your wallet.' : 'New boost purchases are currently unavailable.'))}</p>
      <details class="explore-boost-history" ${historyOpen ? 'open' : ''}><summary>Payment history${historyRows.length ? ` (${historyRows.length})` : ''}</summary>${historyRows.map(row => `<p><span><strong>${appState.escapeHtml(row.packageId)} · ${appState.escapeHtml(row.state)}</strong><small>${row.pending ? 'Check the original payment before buying again.' : row.expiresAt ? `Expires ${appState.escapeHtml(new Date(row.expiresAt).toLocaleString())}` : 'View transaction for details'}</small></span><a href="${appState.escapeHtml(appState.exploreExplorer(`tx/${encodeURIComponent(row.signature)}`))}" target="_blank" rel="noopener noreferrer">${row.pending ? 'View transaction' : 'View receipt'} ↗</a></p>`).join('') || `<small>${appState.exploreBoostHistoryState === 'loading' ? 'Loading payment history…' : appState.exploreBoostHistoryState === 'unavailable' ? 'Payment history is unavailable. Reopen this window to try again.' : 'No boost purchases yet.'}</small>`}</details>
      <details class="explore-boost-how advanced-details" ${advancedOpen ? 'open' : ''}><summary>Advanced details · boosts</summary><p>Each new purchase adds ${selected.hours} hours to the remaining boost time and increases its total quantity immediately after confirmation. For example, 10× with 5 hours left plus a 10×/12-hour pack becomes 20× for 17 hours. After expiry, a new purchase starts fresh. 500 active boosts unlock the golden ticker. Paid boosts improve visibility, but do not guarantee a Top 100 position or returns.</p></details>`;
  }
  // app-source-end

  // app-source: 294
  async function handleExploreBoostPay(){
    if (appState.boostCheckout.busy || !appState.boostCheckout.mint || appState.boostCheckout.recoveryError) return;
    if (appState.connectedWalletAddress && appState.boostCheckout.quote?.payer
      && appState.boostCheckout.quote.payer !== appState.connectedWalletAddress) {
      appState.openExploreBoost(appState.boostCheckout.mint);return;
    }
    if (appState.boostCheckout.failureProof) {
      try {
        appState.archiveBoostPayment(appState.boostCheckout, appState.boostCheckout.failureProof);
        appState.boostCheckout.pendingSignature = null;
        appState.boostCheckout.quote = null;
        appState.boostCheckout.failureProof = null;
        appState.boostCheckout.reviewedQuote = null;
        appState.boostCheckout.message = 'The resolved attempt is saved in device history. Choose a package and request a new quote when ready.';
      } catch (error) { appState.boostCheckout.message = error.message || 'Recovery could not be saved. Keep the original payment and retry.'; }
      appState.renderExploreBoostDialog();
      return;
    }
    if (appState.boostCheckout.pendingSignature) return appState.verifyExploreBoostPayment();
    appState.boostCheckout.busy = true;
    appState.boostCheckout.message = '';
    appState.renderExploreBoostDialog();
    try {
      if (!appState.wallet) await appState.connectWallet();
      const session = appState.captureWalletSession();
      if (!session || !appState.canSignTransactions(session.provider)) throw new Error('Connect a Solana wallet that can sign transactions.');
      if (restorePendingBoost(appState.boostCheckout.mint,session.address)) { await appState.verifyExploreBoostPayment(true);return; }
      if (!appState.boostCheckout.quote || appState.boostCheckout.quote.mint !== appState.boostCheckout.mint || appState.boostCheckout.quote.packageId !== appState.boostCheckout.packageId || appState.boostCheckout.quote.payer !== session.address || Date.parse(appState.boostCheckout.quote.expiresAt) <= Date.now()) {
        const response = await appState.apiRequest('/api/boosts/quote', { method:'POST', body:{ mint:appState.boostCheckout.mint, payer:session.address, packageId:appState.boostCheckout.packageId, paymentProtocol:'journal-v1' } });
        appState.assertWalletSessionCurrent(session);
        if (!response.available) throw new Error('Quotes are unavailable. Try again shortly.');
        try {
          appState.boostCheckout.quote = appState.validateBoostQuote(response.data, { mint: appState.boostCheckout.mint, payer: session.address,
            packageId: appState.boostCheckout.packageId, pricing:{packages:livePackages,revision:pricingRevision} });
        } catch(error) { appState.boostCheckout.quote=null;await appState.loadExploreBoostHistory(appState.boostCheckout.mint);throw error; }
        appState.boostCheckout.reviewedQuote = {...appState.boostCheckout.quote};
        appState.boostCheckout.message = 'Review the exact SOL amount and recipient, then select Pay.';
      } else {
        const { PublicKey, SystemProgram, Transaction, TransactionInstruction } = await appState.getSolana();
        appState.assertWalletSessionCurrent(session);
        const rpc = appState.connection;
        const expected={mint:appState.boostCheckout.mint,payer:session.address,packageId:appState.boostCheckout.packageId,reviewedQuote:appState.boostCheckout.reviewedQuote};
        const quote = appState.validateBoostQuote(appState.boostCheckout.quote, expected);
        const preparation=await appState.apiRequest('/api/boosts/prepare',{method:'POST',body:{quoteId:quote.id}});
        const prepared=preparation.data;
        if (!preparation.available || prepared?.quoteId!==quote.id || prepared.cluster!=='devnet'
          || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(prepared.blockhash)
          || !Number.isSafeInteger(prepared.expiryUpperBound) || prepared.expiryUpperBound<1 || prepared.expiresAt!==quote.expiresAt)
          throw Error('Payment preparation could not be verified. No transaction was requested.');
        const latest={blockhash:prepared.blockhash,lastValidBlockHeight:prepared.expiryUpperBound};
        appState.assertWalletSessionCurrent(session);
        appState.validateBoostQuote(quote, expected);
        const transaction = new Transaction().add(
          SystemProgram.transfer({ fromPubkey:session.provider.publicKey, toPubkey:new PublicKey(quote.recipient), lamports:quote.lamports }),
          new TransactionInstruction({ keys:[], programId:new PublicKey(appState.BOOST_MEMO_PROGRAM), data:new TextEncoder().encode(quote.memo) }),
        );
        transaction.feePayer = session.provider.publicKey;
        transaction.recentBlockhash = latest.blockhash;
        const [balance, fee] = await Promise.all([
          rpc.getBalance(session.provider.publicKey, 'confirmed'),
          rpc.getFeeForMessage(transaction.compileMessage(), 'confirmed'),
        ]);
        appState.assertWalletSessionCurrent(session);
        if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(fee?.value) || fee.value < 0) throw new Error('Unable to check your balance and network fee. Try again.');
        if(fee.value>MAX_BOOST_NETWORK_FEE_LAMPORTS)throw Error('Network fee exceeds the 0.001 SOL checkout limit. No payment was sent.');
        if (balance < quote.lamports + fee.value) throw new Error(`Not enough SOL. You need ${((quote.lamports + fee.value) / 1e9).toFixed(9)} SOL including the network fee. No payment was sent.`);
        appState.boostCheckout.message = 'Review the SOL transfer and boost memo in your wallet.';
        appState.renderExploreBoostDialog();
        const reviewedPayment=snapshotBoostPayment(transaction);
        const signed = await session.provider.signTransaction(transaction);
        appState.assertWalletSessionCurrent(session);
        appState.validateBoostQuote(quote, expected);
        const signedBytes = signed.serialize();
        const payment=Transaction.from(signedBytes);
        assertBoostWalletPayment(payment,reviewedPayment);
        if (!payment.verifySignatures() || payment.signatures.length!==1 || !payment.signature || payment.signature.length !== 64)
          throw new Error('Wallet returned a transaction without a valid signature. No payment was sent.');
        // Phantom may add priority fees. Check the actual signed message's fee,
        // not just the unsigned estimate, before journaling or broadcasting.
        const [signedBalance,signedFee]=await Promise.all([
          rpc.getBalance(session.provider.publicKey,'confirmed'),rpc.getFeeForMessage(payment.compileMessage(),'confirmed'),
        ]);
        appState.assertWalletSessionCurrent(session);
        appState.validateBoostQuote(quote,expected);
        if(!Number.isSafeInteger(signedBalance)||!Number.isSafeInteger(signedFee?.value)||signedFee.value<0)
          throw Error('Unable to verify the wallet-selected network fee. No payment was sent.');
        if(signedFee.value>MAX_BOOST_NETWORK_FEE_LAMPORTS)
          throw Error('Wallet network fee exceeds 0.001 SOL. Lower the priority fee in your wallet and retry. No payment was sent.');
        if(BigInt(signedBalance)<BigInt(quote.lamports)+BigInt(signedFee.value))
          throw Error('Not enough SOL for the boost and wallet-selected network fee. No payment was sent.');
        const signature = appState.bs58.encode(payment.signature);
        // Persist the signed identity BEFORE broadcast. An RPC timeout can occur after acceptance.
        // Recovery remains verification-only until the original signature is resolved.
        const signedTransaction=appState.Buffer.from(signedBytes).toString('base64');
        try { await appState.saveSignedBoostPayment({ quote, signature, blockhash:latest.blockhash, signedTransaction, lastValidBlockHeight: latest.lastValidBlockHeight }); }
        catch (error) { throw new Error(`${error.message || 'Device recovery storage is unavailable.'} No payment was sent.`); }
        appState.boostCheckout.pendingSignature = signature;
        appState.boostCheckout.quote = quote;
        appState.boostCheckout.blockhash = latest.blockhash;
        appState.boostCheckout.signedTransaction = signedTransaction;
        const journal=await appState.apiRequest('/api/boosts/confirm',{method:'POST',body:{quoteId:quote.id,signature,signedTransaction}});
        appState.assertWalletSessionCurrent(session);
        if (!journal.available || journal.data?.signature!==signature || journal.data?.quoteId!==quote.id)
          throw Error('Payment recovery could not be saved. Check the original payment before retrying.');
        if (appState.boostPaymentResolution(journal.data,appState.boostCheckout)!=='pending') {await appState.verifyExploreBoostPayment(true);return;}
        if (!journal.data.journaled || !journal.data.broadcastAllowed) throw Error('This attempt is no longer available to send. Check its expiry before starting again.');
        const submitted = await rpc.sendRawTransaction(signedBytes, { skipPreflight:false, maxRetries:3 });
        if (submitted !== signature) throw new Error('RPC returned a different signature. Verify the originally signed payment before continuing.');
        appState.boostCheckout.message = 'Payment submitted. Waiting for confirmation.';
        await appState.verifyExploreBoostPayment(true);
        return;
      }
    } catch (error) { appState.boostCheckout.message = appState.boostCheckout.pendingSignature ? 'Payment is not confirmed. Use Retry payment verification to check the original transaction before paying again.' : error.message || 'Boost checkout failed. No boost was activated.'; }
    finally { appState.boostCheckout.busy = false; appState.renderExploreBoostDialog(); }
  }
  // app-source-end

  // app-source: 295
  async function verifyExploreBoostPayment(alreadyBusy = false){
    if (!appState.boostCheckout.pendingSignature || !appState.boostCheckout.quote) return;
    if (!alreadyBusy) { appState.boostCheckout.busy = true; appState.renderExploreBoostDialog(); }
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await appState.apiRequest('/api/boosts/confirm', { method:'POST', body:{ quoteId:appState.boostCheckout.quote.id,
          signature:appState.boostCheckout.pendingSignature, signedTransaction:appState.boostCheckout.signedTransaction } });
        if (!response.available) throw new Error('Payment verification is unavailable. Try again shortly.');
        const resolution = appState.boostPaymentResolution(response.data, appState.boostCheckout);
        if (resolution === 'failed' || resolution === 'expired') {
          appState.boostCheckout.failureProof = response.data;
          appState.boostCheckout.message = resolution==='expired'
            ? 'The transaction expired without a transfer. You can start a new purchase and choose any package.'
            : 'The transaction failed on-chain. The boost payment was not transferred; a network fee may apply. You can start a new quote.';
          return;
        }
        if (resolution === 'finalized') {
          const mint = appState.boostCheckout.mint;
          appState.archiveBoostPayment(appState.boostCheckout, response.data);
          appState.productEvent('boost_confirmed');
          appState.boostCheckout.pendingSignature = null;
          appState.boostCheckout.quote = null;
          appState.boostCheckout.message = 'Your boost is active. You can buy another boost or view your receipt below.';
          await appState.loadVerifiedBoosts();
          await appState.loadExploreBoostHistory(mint);
          window.dispatchEvent(new Event('funded:boost-verified'));
          void appState.refreshWalletBalance({ force:true });
          void appState.refreshTradeBalances();
          return;
        }
        if (!appState.boostCheckout.signedTransaction) {
          appState.boostCheckout.message='This older payment has no saved signed transaction for automatic expiry recovery. Its receipt can still be checked. Contact support with its signature if it never reached Solana; do not pay again while its outcome is unknown.';
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      appState.boostCheckout.message = 'The payment outcome is still unconfirmed. Check the original transaction again. An expired quote alone does not mean the payment failed.';
    } catch (error) { appState.boostCheckout.message = `${error.message || 'Payment verification failed.'} Retry this transaction; do not pay again.`; }
    finally { appState.boostCheckout.busy = false; appState.renderExploreBoostDialog(); }
  }
  // app-source-end

  return { exploreBoostStatus, exploreBoostAmountMarkup, exploreTierBadgeMarkup, openExploreTierInfo, exploreAirdropMarkup, boostAssetForMint, openExploreBoost, loadExploreBoostHistory, renderExploreBoostDialog, handleExploreBoostPay, verifyExploreBoostPayment };
}
