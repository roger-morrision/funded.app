import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeHomeFeed(appState) {
  // app-source: 480
  const homeHolderCountCache = new Map();
  initializeAppState(appState, 'homeHolderCountCache', homeHolderCountCache);
  // app-source-end

  // app-source: 481
  let homeFeeAmounts = new Map();
  initializeAppState(appState, 'homeFeeAmounts', homeFeeAmounts);
  // app-source-end

  // app-source: 482
  let homeHolderCountLoading = false;
  initializeAppState(appState, 'homeHolderCountLoading', homeHolderCountLoading);
  // app-source-end

  // app-source: 483
  let homeFeeIndexLoading = false;
  initializeAppState(appState, 'homeFeeIndexLoading', homeFeeIndexLoading);
  // app-source-end

  const paidTableWrap = document.querySelector('#home-launch-table-wrap');
  if (paidTableWrap && !document.querySelector('#home-paid-listing-table'))
    paidTableWrap.insertAdjacentHTML('beforeend', "<table class=\"home-launch-table home-paid-listing-table\" id=\"home-paid-listing-table\" hidden><thead><tr><th scope=\"col\">Token</th><th scope=\"col\">Mint</th><th scope=\"col\">Listed</th><th scope=\"col\">Payment proof</th></tr></thead><tbody id=\"home-paid-listing-table-body\"></tbody></table>");
  // app-source: 492
  document.querySelectorAll('[data-home-launch-tab]').forEach(button => button.addEventListener('click', () => {
    appState.homeLaunchTab = button.dataset.homeLaunchTab || 'all';
    appState.homeFrozenOrder = null;
    document.querySelectorAll('[data-home-launch-tab]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
    appState.renderHomeLaunchBoard();
    if (appState.homeLaunchTab === 'paid-listing') void appState.loadHomePaidListings();
  }));
  document.querySelector('#home-launch-table-wrap')?.addEventListener('click', event => {
    if (event.target.closest('[data-paid-listing-retry]')) void appState.loadHomePaidListings();
  });
  document.querySelector('#home-launch-grid')?.addEventListener('click', event => {
    if (event.target.closest('[data-paid-listing-retry]')) void appState.loadHomePaidListings();
  });
  window.addEventListener('funded:listing-verified', () => {
    if (appState.homeLaunchTab === 'paid-listing') void appState.loadHomePaidListings();
  });
  // app-source-end

  // app-source: 493
  for (const [selector, property] of [['[data-home-window]', 'homeWindow'], ['[data-home-sort]', 'homeSort'], ['[data-home-view]', 'homeView']]) {
    document.querySelectorAll(selector).forEach(button => button.addEventListener('click', () => {
      const value = button.dataset[property];
      if (property === 'homeWindow') appState.homeLaunchWindow = value;
      else if (property === 'homeSort') {
        appState.homeLaunchSort = value;
        if (value === 'market-cap') appState.setHomeLaunchPaused(false);
      }
      else appState.homeLaunchView = value;
      if (property !== 'homeView') appState.homeFrozenOrder = null;
      document.querySelectorAll(selector).forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      appState.renderHomeLaunchBoard();
    }));
  }
  // app-source-end

  // app-source: 494
  const homeFilterPopup = document.querySelector('.home-feed-settings');
  initializeAppState(appState, 'homeFilterPopup', homeFilterPopup);
  // app-source-end

  // app-source: 495
  const homeFilterForm = document.querySelector('#home-launch-filter-form');
  initializeAppState(appState, 'homeFilterForm', homeFilterForm);
  // app-source-end

  // app-source: 496
  const HOME_FILTER_PRESETS_KEY = 'funded.home.launch-filters.v1';
  initializeAppState(appState, 'HOME_FILTER_PRESETS_KEY', HOME_FILTER_PRESETS_KEY);
  // app-source-end

}
