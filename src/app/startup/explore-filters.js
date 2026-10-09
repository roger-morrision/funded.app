// Startup runs in the order declared in start.js.
export function initializeExploreFilters(appState) {
  // app-source: 431
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-verified-feed-retry]');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Checking launches…';
    try { await appState.loadOnchainExploreData(); }
    catch { appState.showToast('Verification is unavailable. Please try again shortly.'); }
    finally { button.disabled = false; button.textContent = 'Try again'; }
  });
  // app-source-end

  // app-source: 432
  document.querySelector('#asset-grid')?.addEventListener('focusout', () => {
    queueMicrotask(() => {
      const grid = document.querySelector('#asset-grid');
      if (grid?.dataset.refreshPending && !grid.contains(document.activeElement)) appState.renderExploreAssets();
    });
  });
  // app-source-end

  // app-source: 433
  document.querySelector('#explore-ticker')?.addEventListener('click', event => {
    if (event.target.closest('.explore-ticker-view-all')) document.querySelector('.explore-heading')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  // app-source-end

}
