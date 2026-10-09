// Startup runs in the order declared in start.js.
export function initializeFollowing(appState) {
  // app-source: 403
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-unfollow-wallet]');
    if (button) appState.saveFollowedWallet(button.dataset.unfollowWallet, { remove: true });
  });
  // app-source-end

  // app-source: 404
  window.addEventListener('storage', event => {
    if (event.key !== appState.FOLLOWED_WALLETS_KEY && event.key !== null) return;
    appState.renderFollowedWallets();
    if (!document.querySelector('#wallet-page')?.hidden) appState.renderWalletDetail();
  });
  // app-source-end

}
