// Dependencies and mutable application state are read live through appState.
export function createCreatorFeesController(appState) {
  // app-source: 901
  function coinFeeSol(value) {
    try {
      const amount = BigInt(value);
      if (amount < 0n) return '—';
      const whole = amount / 1_000_000_000n;
      const fraction = String(amount % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
      return `${whole}${fraction ? `.${fraction}` : ''} SOL`;
    } catch { return '—'; }
  }
  // app-source-end

  // app-source: 905
  function renderCoinSummary(){
    return appState.renderCoinSummaryView({ coinSummaryLaunch: appState.coinSummaryLaunch, coinSummaryLedgerMint: appState.coinSummaryLedgerMint, currentCoinFeeOverview: appState.currentCoinFeeOverview, coinMarketActivity: appState.coinMarketActivity, coinSolUsdPrice: appState.coinSolUsdPrice, coinSolUsdValues: appState.coinSolUsdValues, EXPLORE_CLUSTER: appState.EXPLORE_CLUSTER }, { getCoinMintAddress: appState.getCoinMintAddress });
  }
  // app-source-end

  // app-source: 906
  function renderCoinFeeDashboard(overview = null) {
    appState.currentCoinFeeOverview = overview;
    appState.renderCoinSummary();
    const root = document.querySelector('#coin-fee-dashboard');
    if (!root) return;
    const owned = Boolean(overview?.available && appState.connectedWalletAddress && overview.creatorWallet === appState.connectedWalletAddress);
    root.hidden = !owned;
    root.replaceChildren();
    if (!owned) return;
    const claim = overview.creatorClaim;
    const claimable = BigInt(claim?.claimableLamports || '0');
    const minimum = BigInt(claim?.minimumLamports || '10000000');
    const ready = Boolean(claim?.eligible && claimable >= minimum && appState.wallet && typeof appState.wallet.signMessage === 'function');
    const note = claimable < minimum
      ? `You can claim once your creator rewards reach ${appState.coinFeeSol(minimum)}.`
      : claim?.eligible ? 'Approve a message in your wallet to request your SOL payout.'
        : 'Your payout is being processed. Confirmed payments appear in Rewards.';
    root.innerHTML = `<section class="coin-creator-claim"><div><span>Your creator rewards</span><strong>${appState.escapeHtml(appState.coinFeeSol(claimable))}</strong><small>${appState.escapeHtml(note)}</small></div><button type="button" id="coin-creator-claim-button" ${ready ? '' : 'disabled'}>Claim creator fees</button></section>`;
    const claimButton = root.querySelector('#coin-creator-claim-button');
    if (claimButton && ready) claimButton.onclick = () => { void appState.requestCreatorFeeClaim(claimButton); };
  }
  // app-source-end

  // app-source: 909
  async function requestCreatorFeeClaim(button, mint = appState.getCoinMintAddress(), overview = appState.currentCoinFeeOverview) {
    const session = appState.captureWalletSession();
    if (!mint || !session || !overview?.available || session.address !== overview.creatorWallet || appState.creatorClaimsInFlight.has(mint)) return;
    if (session.provider.readOnly || typeof session.provider.signMessage !== 'function') { appState.showToast('Open your signing wallet to claim SOL.'); return; }
    appState.creatorClaimsInFlight.add(mint);
    const originalLabel = button.textContent;
    let requested = false;
    try {
      button.disabled = true;
      button.textContent = 'Waiting for wallet…';
      const path = `/api/tokens/${encodeURIComponent(mint)}/creator-claim`;
      const prepared = await appState.apiRequest(`${path}/prepare`, { method:'POST', body:{} });
      appState.assertWalletSessionCurrent(session);
      if (!prepared.available || !prepared.data?.statement || !prepared.data?.challengeId) throw new Error('Unable to prepare this claim. Refresh and try again.');
      const signed = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
      appState.assertWalletSessionCurrent(session);
      button.textContent = 'Requesting payout…';
      const result = await appState.apiRequest(`${path}/request`, { method:'POST', body:{ challengeId:prepared.data.challengeId, signature:appState.bs58.encode(signed.signature || signed) } });
      if (!result.available || result.data?.status !== 'payout-requested') throw new Error('Unable to confirm the request. Refresh to check its status.');
      requested = true;
      button.textContent = 'Payout requested';
      appState.showToast('Payout requested. Check Rewards for confirmation.');
      const updated = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`);
      appState.assertWalletSessionCurrent(session);
      if (appState.getCoinMintAddress() === mint && updated.available && updated.data?.mint === mint) {
        appState.coinSummaryLedgerMint = mint;
        appState.renderCoinFeeDashboard(updated.data.overview);
      }
    } catch (error) {
      appState.showToast(`Creator claim: ${error.message}`);
      if (button.isConnected && !requested) { button.disabled = false; button.textContent = originalLabel; }
    } finally { appState.creatorClaimsInFlight.delete(mint); }
  }
  // app-source-end

  return { coinFeeSol, renderCoinSummary, renderCoinFeeDashboard, requestCreatorFeeClaim };
}
