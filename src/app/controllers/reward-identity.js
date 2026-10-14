// Dependencies and mutable application state are read live through appState.
export function createRewardIdentityController(appState) {
  // app-source: 1004
  function renderXClaimSummary(claims) {
    return appState.renderXClaimSummaryFeature(claims, {  });
  }
  // app-source-end

  // app-source: 1005
  async function loadXIdentity() {
    return appState.loadXIdentityFeature({ renderXClaimSummary: appState.renderXClaimSummary, syncXClaimFlow: appState.syncXClaimFlow, refreshXClaims: appState.refreshXClaims, resetSolClaimStatus: appState.resetSolClaimStatus, watchlistSync: appState.watchlistSync, restoreWalletFavorites: appState.restoreWalletFavorites, apiRequest: appState.apiRequest });
  }
  // app-source-end

  // app-source: 1006
  async function refreshXClaims() {
    return appState.refreshXClaimsFeature({ renderXClaimSummary: appState.renderXClaimSummary, syncXClaimFlow: appState.syncXClaimFlow, verifiedLaunchPolicyForMint: appState.verifiedLaunchPolicyForMint, updateClaimBindingReview: appState.updateClaimBindingReview, resetSolClaimStatus: appState.resetSolClaimStatus, apiRequest: appState.apiRequest });
  }
  // app-source-end

  async function submitV3XClaim() {
    const button=document.querySelector('#sol-claim-submit');
    const status=document.querySelector('#sol-claim-status');
    const signature=document.querySelector('#sol-claim-id')?.value?.trim();
    const row=[...document.querySelectorAll('#sol-claim-list [data-claim-id]')]
      .find(item=>item.dataset.claimId===signature);
    const session=appState.captureWalletSession();
    const mint=row?.dataset.mint;
    if (!button || !status || !signature || !mint || row.dataset.claimScope!=='per-mint-v3'
      || !session?.address || !document.querySelector('#claim-binding-agree')?.checked
      || typeof session.provider.signMessage!=='function') return;
    const base=`/api/tokens/${encodeURIComponent(mint)}/v3-x-claim/${encodeURIComponent(signature)}`;
    button.disabled=true;
    try {
      status.textContent='Checking finalized V3 allocation and funding…';
      const prepared=await appState.apiRequest(`${base}/prepare`, { method:'POST', body:{ wallet:session.address } });
      appState.assertWalletSessionCurrent(session);
      if (!prepared.available) throw new Error('V3 X claim preparation is unavailable.');
      if (prepared.data?.wallet && prepared.data.wallet!==session.address)
        throw new Error('This reward is bound to another wallet.');
      if (!prepared.data?.wallet) {
        if (!prepared.data?.statement) throw new Error('The wallet challenge is unavailable.');
        status.textContent='Sign the wallet message to bind this reward.';
        const signed=await session.provider.signMessage(new TextEncoder().encode(prepared.data.statement));
        appState.assertWalletSessionCurrent(session);
        const verified=await appState.apiRequest(`${base}/verify`, { method:'POST', body:{
          wallet:session.address, signature:appState.bs58.encode(signed.signature||signed) } });
        appState.assertWalletSessionCurrent(session);
        if (!verified.available || !['ready','paid'].includes(verified.data?.status)
          || verified.data?.wallet!==session.address)
          throw new Error(verified.data?.error||'The recipient wallet could not be verified.');
      }
      status.textContent='Submitting and verifying the Devnet payout…';
      const paid=await appState.apiRequest(`${base}/execute`, { method:'POST', body:{} });
      appState.assertWalletSessionCurrent(session);
      if (!paid.available || paid.data?.status!=='paid' || !paid.data?.payment?.finalized
        || !paid.data?.payment?.balanceDeltaVerified)
        throw new Error('The payout is pending finalized on-chain verification.');
      status.textContent='V3 X payout finalized and verified.';
      await appState.refreshXClaims();
    } catch(error) { status.textContent=error.message||'V3 X payout is unavailable.'; }
    finally { button.disabled=false;appState.syncXClaimFlow(); }
  }

  return { renderXClaimSummary, loadXIdentity, refreshXClaims, submitV3XClaim };
}
