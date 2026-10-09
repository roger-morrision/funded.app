import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeHomeFilters(appState) {
  // app-source: 504
  appState.homeFilterPopup?.addEventListener('toggle', () => {
    if (appState.homeFilterPopup.open) { appState.writeHomeFilterForm(appState.homeLaunchFilters); appState.showHomeFilterView('current'); }
  });
  // app-source-end

  // app-source: 505
  document.querySelector('#home-filter-close')?.addEventListener('click', () => { appState.homeFilterPopup.open = false; });
  // app-source-end

  // app-source: 506
  document.querySelectorAll('[data-home-filter-view]').forEach(button => button.addEventListener('click', () => appState.showHomeFilterView(button.dataset.homeFilterView)));
  // app-source-end

  // app-source: 507
  appState.homeFilterForm?.addEventListener('submit', event => {
    event.preventDefault();
    appState.applyHomeFilterForm(appState.readHomeFilterForm());
    appState.homeFilterPopup.open = false;
  });
  // app-source-end

  // app-source: 508
  document.querySelector('#home-filter-reset')?.addEventListener('click', () => {
    appState.writeHomeFilterForm(appState.emptyHomeLaunchFilters());
    appState.applyHomeFilterForm(appState.emptyHomeLaunchFilters());
  });
  // app-source-end

  // app-source: 509
  document.querySelector('#home-filter-save-open')?.addEventListener('click', () => {
    appState.showHomeFilterView('saved');
    document.querySelector('#home-filter-preset-name')?.focus();
  });
  // app-source-end

  // app-source: 510
  document.querySelector('#home-filter-save')?.addEventListener('click', () => {
    const input = document.querySelector('#home-filter-preset-name');
    const name = input?.value.trim().slice(0, 40);
    if (!name) { input?.focus(); return; }
    const presets = appState.readHomeFilterPresets().filter(item => item.name.toLowerCase() !== name.toLowerCase());
    presets.unshift({ name, filters: appState.readHomeFilterForm() });
    try { localStorage.setItem(appState.HOME_FILTER_PRESETS_KEY, JSON.stringify(presets.slice(0, 10))); } catch {}
    input.value = '';
    appState.renderHomeFilterPresets();
  });
  // app-source-end

  // app-source: 511
  document.querySelector('#home-filter-saved-list')?.addEventListener('click', event => {
    const load = event.target.closest('[data-home-preset-load]');
    const remove = event.target.closest('[data-home-preset-delete]');
    if (!load && !remove) return;
    const presets = appState.readHomeFilterPresets();
    const index = Number((load || remove).dataset[load ? 'homePresetLoad' : 'homePresetDelete']);
    if (!Number.isInteger(index) || !presets[index]) return;
    if (load) {
      appState.writeHomeFilterForm(presets[index].filters);
      appState.applyHomeFilterForm(presets[index].filters);
      appState.homeFilterPopup.open = false;
    } else {
      presets.splice(index, 1);
      try { localStorage.setItem(appState.HOME_FILTER_PRESETS_KEY, JSON.stringify(presets)); } catch {}
      appState.renderHomeFilterPresets();
    }
  });
  // app-source-end

  // app-source: 512
  document.addEventListener('pointerdown', event => {
    if (appState.homeFilterPopup?.open && !appState.homeFilterPopup.contains(event.target)) appState.homeFilterPopup.open = false;
  });
  // app-source-end

  // app-source: 513
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && appState.homeFilterPopup?.open) appState.homeFilterPopup.open = false;
  });
  // app-source-end

  // app-source: 514
  appState.renderHomeFilterPresets();
  // app-source-end

  // app-source: 515
  appState.syncHomeFilterIndicator();
  // app-source-end

  // app-source: 516
  document.querySelector('#home-feed-pause')?.addEventListener('click', () => {
    appState.setHomeLaunchPaused(!appState.homeLaunchPaused);
    appState.renderHomeLaunchBoard();
  });
  // app-source-end

  // app-source: 517
  document.querySelector('#home-table-sort-mc')?.addEventListener('click', () => {
    document.querySelector('[data-home-sort="market-cap"]')?.click();
  });
  // app-source-end

  // app-source: 518
  document.querySelector('#home-market-ticker-items')?.addEventListener('scroll', appState.syncHomeTickerArrows, { passive: true });
  // app-source-end

  // app-source: 519
  document.querySelector('#home-market-ticker-items')?.addEventListener('pointerdown', () => {
    appState.homeTickerPauseUntil = performance.now() + 3000;
  });
  // app-source-end

  // app-source: 520
  for (const [id, direction] of [['home-ticker-back', -1], ['home-ticker-forward', 1]]) {
    document.querySelector(`#${id}`)?.addEventListener('click', () => {
      const ticker = document.querySelector('#home-market-ticker-items');
      if (!ticker) return;
      appState.homeTickerPauseUntil = performance.now() + 2000;
      const distance = direction * Math.max(180, ticker.clientWidth * .7);
      if (appState.homeTickerCycleWidth) ticker.scrollLeft = ((ticker.scrollLeft + distance) % appState.homeTickerCycleWidth + appState.homeTickerCycleWidth) % appState.homeTickerCycleWidth;
      else ticker.scrollBy({ left: distance, behavior: 'smooth' });
    });
  }
  // app-source-end

  // app-source: 521
  window.addEventListener('resize', () => {
    const ticker = document.querySelector('#home-market-ticker-items');
    if (ticker && appState.homeTickerCount) appState.setupHomeTicker(ticker, appState.homeTickerRenderKey, appState.homeTickerCount, true);
    appState.syncHomeTickerArrows();
  });
  // app-source-end

  // app-source: 522
  let exploreLoadInFlight = null;
  initializeAppState(appState, 'exploreLoadInFlight', exploreLoadInFlight);
  // app-source-end

}
