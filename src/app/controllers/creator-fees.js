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
    const pending = BigInt(claim?.pendingLamports || '0');
    const minimum = BigInt(claim?.minimumLamports || '10000000');
    const hasPending = Number(claim?.pendingCount || 0) > 0;
    const ready = Boolean(((claim?.eligible && claimable >= minimum) || hasPending) && appState.wallet && !appState.wallet.readOnly
      && typeof appState.wallet.signMessage === 'function' && typeof appState.wallet.signTransaction === 'function');
    const note = claimable < minimum && !hasPending
      ? `Claims open at ${appState.coinFeeSol(minimum)} of allocated creator fees.`
      : ready ? 'Sign a claim message, then approve each exact Devnet payout in your wallet. Finalized balance proof is required.'
        : 'Open this app in the launch creator wallet to approve exact payouts.';
    root.innerHTML = `<section class="coin-creator-claim"><div><span>Creator allocated fees</span><strong>${appState.escapeHtml(appState.coinFeeSol(claimable + pending))}</strong><small>${appState.escapeHtml(note)}</small></div><button type="button" id="coin-creator-claim-button" ${ready ? '' : 'disabled'}>Approve creator payouts</button></section>`;
    const claimButton = root.querySelector('#coin-creator-claim-button');
    if (claimButton && ready) claimButton.onclick = () => { void appState.requestCreatorFeeClaim(claimButton); };
    const funding = (overview.rewardFunding || []).filter(row => ['pending','awaiting-creator-signature','verification-pending'].includes(row.status));
    if (funding.length) {
      const section = document.createElement('section');
      section.className = 'coin-creator-claim';
      const summary = document.createElement('div');
      const title = document.createElement('span'); title.textContent = 'Holder and app reward funding';
      const amount = document.createElement('strong');
      amount.textContent = appState.coinFeeSol(funding.reduce((total, row) => total + BigInt(row.amountLamports), 0n));
      const detail = document.createElement('small');
      detail.textContent = `${funding.length} allocation${funding.length === 1 ? '' : 's'} need your approval. Review each destination and amount in your wallet.`;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = 'Review reward funding';
      button.disabled = !appState.wallet || appState.wallet.readOnly || typeof appState.wallet.signTransaction !== 'function';
      if (!button.disabled) button.onclick = () => { void requestRewardFunding(button); };
      summary.append(title, amount, detail); section.append(summary, button); root.append(section);
    }
  }
  // app-source-end

  // app-source: 909
  async function requestCreatorFeeClaim(button, mint = appState.getCoinMintAddress(), overview = appState.currentCoinFeeOverview) {
    const session = appState.captureWalletSession();
    if (!mint || !session || !overview?.available || session.address !== overview.creatorWallet || appState.creatorClaimsInFlight.has(mint)) return;
    if (session.provider.readOnly || typeof session.provider.signMessage !== 'function'
      || typeof session.provider.signTransaction !== 'function') {
      appState.showToast('Open your signing wallet to approve creator payouts.'); return;
    }
    appState.creatorClaimsInFlight.add(mint);
    const originalLabel = button.textContent;
    try {
      button.disabled = true;
      button.textContent = 'Checking Devnet…';
      const route = await appState.apiRequest('/api/mint-router/creator-settlement-status');
      if (!route.data?.ready) throw new Error(route.data?.reasons?.join('; ') || 'Creator settlement service is unavailable.');
      appState.assertWalletSessionCurrent(session);
      const path = `/api/tokens/${encodeURIComponent(mint)}/creator-claim`;
      const prepared = await appState.apiRequest(`${path}/prepare`, { method:'POST', body:{} });
      appState.assertWalletSessionCurrent(session);
      if (!prepared.available || !prepared.data?.statement || !prepared.data?.challengeId) throw new Error('Unable to prepare this claim. Refresh and try again.');
      button.textContent = 'Waiting for wallet…';
      const message = await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
      appState.assertWalletSessionCurrent(session);
      const requested = await appState.apiRequest(`${path}/request`, { method:'POST', body:{
        challengeId:prepared.data.challengeId, signature:appState.bs58.encode(message.signature || message) } });
      if (requested.data?.status !== 'awaiting-creator-signature' || !Array.isArray(requested.data.requestIds)) throw new Error('Creator claim batch is unavailable.');
      const { Transaction } = await appState.getSolana();
      let paid = 0;
      for (const requestId of requested.data.requestIds) {
        appState.assertWalletSessionCurrent(session);
        button.textContent = `Approving ${paid + 1} of ${requested.data.requestIds.length}…`;
        const review = await appState.apiRequest(`${path}/settle`, { method:'POST', body:{ requestId } });
        if (review.data?.status === 'paid') { paid++; continue; }
        if (review.data?.status !== 'awaiting-creator-signature' || review.data.creatorWallet !== session.address) throw new Error('Creator payout review changed.');
        const transaction = Transaction.from(appState.base64ToBytes(review.data.transaction));
        const signed = await session.provider.signTransaction(transaction);
        appState.assertWalletSessionCurrent(session);
        const result = await appState.apiRequest(`${path}/settle`, { method:'POST', body:{ requestId,
          creatorSignedTransaction:appState.bytesToBase64(signed.serialize({ requireAllSignatures:false, verifySignatures:false })) } });
        if (result.data?.status !== 'paid' || !result.data.signature) throw new Error('Payout outcome is uncertain. Refresh and review the claim before signing again.');
        paid++;
      }
      appState.showToast(`${paid} creator payout${paid === 1 ? '' : 's'} finalized on Devnet.`);
      const updated = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`);
      appState.assertWalletSessionCurrent(session);
      if (appState.getCoinMintAddress() === mint && updated.available && updated.data?.mint === mint) {
        appState.coinSummaryLedgerMint = mint;
        appState.renderCoinFeeDashboard(updated.data.overview);
      }
    } catch (error) {
      appState.showToast(`Creator claim: ${error.message}`);
      if (button.isConnected) { button.disabled = false; button.textContent = originalLabel; }
    } finally { appState.creatorClaimsInFlight.delete(mint); }
  }
  // app-source-end

  // app-source: 912
  async function requestRewardFunding(button, mint = appState.getCoinMintAddress(), overview = appState.currentCoinFeeOverview) {
    const session = appState.captureWalletSession();
    if (!mint || !session || session.address !== overview?.creatorWallet || appState.creatorClaimsInFlight.has(mint)) return;
    if (session.provider.readOnly || typeof session.provider.signTransaction !== 'function') {
      appState.showToast('Open the launch creator wallet to approve reward funding.'); return;
    }
    appState.creatorClaimsInFlight.add(mint);
    const originalLabel = button.textContent;
    try {
      button.disabled = true;
      const path = `/api/tokens/${encodeURIComponent(mint)}/reward-funding`;
      const listed = await appState.apiRequest(`${path}/pending`);
      appState.assertWalletSessionCurrent(session);
      if (!listed.available || listed.data?.creatorWallet !== session.address || !Array.isArray(listed.data.requests))
        throw new Error('Verified reward allocations are unavailable.');
      const pending = listed.data.requests.filter(row => ['pending','awaiting-creator-signature','verification-pending'].includes(row.status));
      const { Transaction } = await appState.getSolana();
      let approved = 0;
      for (const row of pending) {
        appState.assertWalletSessionCurrent(session);
        const review = await appState.apiRequest(`${path}/settle`, { method:'POST', body:{ requestId:row.id } });
        if (review.data?.status === 'funded' || review.data?.status === 'vault-funded') continue;
        if (review.data?.status !== 'awaiting-creator-signature' || review.data.creatorWallet !== session.address
          || review.data.requestId !== row.id || review.data.kind !== row.kind
          || review.data.amountLamports !== row.amountLamports) throw new Error('Reward funding review changed. Refresh and retry.');
        button.textContent = `Sign ${row.kind} ${appState.coinFeeSol(row.amountLamports)} to ${review.data.recipient}`;
        const transaction = Transaction.from(appState.base64ToBytes(review.data.transaction));
        const signed = await session.provider.signTransaction(transaction);
        appState.assertWalletSessionCurrent(session);
        button.textContent = 'Checking finalized Devnet funding…';
        const result = await appState.apiRequest(`${path}/settle`, { method:'POST', body:{ requestId:row.id,
          creatorSignedTransaction:appState.bytesToBase64(signed.serialize({ requireAllSignatures:false, verifySignatures:false })) } });
        if (result.data?.status !== 'vault-funded' || !result.data.signature) throw new Error('Funding outcome is uncertain. Refresh before signing again.');
        approved++;
      }
      appState.showToast(`${approved} reward allocation${approved === 1 ? '' : 's'} funded on Devnet. Payout scheduling follows finalized reconciliation.`);
      const updated = await appState.apiRequest(`/api/tokens/${encodeURIComponent(mint)}/fee-activity`);
      appState.assertWalletSessionCurrent(session);
      if (appState.getCoinMintAddress() === mint && updated.available && updated.data?.mint === mint)
        appState.renderCoinFeeDashboard(updated.data.overview);
    } catch (error) {
      appState.showToast(`Reward funding: ${error.message}`);
      if (button.isConnected) { button.disabled = false; button.textContent = originalLabel; }
    } finally { appState.creatorClaimsInFlight.delete(mint); }
  }
  // app-source-end

  return { coinFeeSol, renderCoinSummary, renderCoinFeeDashboard, requestCreatorFeeClaim };
}
