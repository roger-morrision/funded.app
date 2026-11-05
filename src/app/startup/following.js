// Startup runs in the order declared in start.js.
export function initializeFollowing(appState) {
  // app-source: 403
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-unfollow-wallet]');
    if (button) appState.saveFollowedWallet(button.dataset.unfollowWallet, { remove: true });
  });
  // app-source-end

  // app-source: 404
  window.addEventListener('funded:account-preferences', () => {
    appState.renderFollowedWallets();
    if (!document.querySelector('#wallet-page')?.hidden) appState.renderWalletDetail();
    if (appState.exploreTab === 'following') {
      appState.updateExploreViews(true);
      void appState.refreshFollowedWalletHoldings();
    }
  });
  // app-source-end

}
