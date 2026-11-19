import {claimXReward} from '../../features/rewards/claim-x-reward.js';
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
    if (!button || button.disabled || !status || !signature || !mint || row.dataset.claimScope!=='per-mint-v3'
      || !session?.address) return;
    button.disabled=true;
    try {
      status.textContent='Claiming your X reward. The app pays the network fee…';
      await claimXReward({session,mint,collectionSignature:signature,amountLamports:row.dataset.amountLamports,
        ensureSession:s=>appState.walletSignIn.ensure(s),assertCurrent:s=>appState.assertWalletSessionCurrent(s),
        request:(...args)=>appState.apiRequest(...args)});
      status.textContent='X reward paid and verified.';
      await appState.refreshXClaims();
    } catch(error) { status.textContent=error.message||'V3 X payout is unavailable.'; }
    finally { button.disabled=false;appState.syncXClaimFlow(); }
  }

  return { renderXClaimSummary, loadXIdentity, refreshXClaims, submitV3XClaim };
}
