import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeLeaderboards(appState) {
  const table = document.querySelector('#leaderboard-table');
  table?.addEventListener('focusin', event => {
    const link = event.target.closest('a[href]');
    if (!link || !table.contains(link) || !link.matches(':focus-visible')
      || table.scrollWidth <= table.clientWidth) return;
    const rect = link.getBoundingClientRect();
    const style = getComputedStyle(link);
    const outline = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
    const left = table.getBoundingClientRect().left + table.clientLeft;
    const right = left + table.clientWidth;
    // Correct only horizontal clipping, after native focus scrolling. Delegation
    // survives row replacements without moving focus or any vertical ancestor.
    if (rect.left - outline < left) table.scrollLeft += rect.left - outline - left;
    else if (rect.right + outline > right) table.scrollLeft += rect.right + outline - right;
  });

  // app-source: 460
  document.querySelector('.leaderboard-tabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-leaderboard-view]');
    if (button) appState.selectLeaderboardView(button.dataset.leaderboardView);
  });
  // app-source-end

  // app-source: 461
  document.querySelector('.leaderboard-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const views = [...document.querySelectorAll('[data-leaderboard-view]')].map(button => button.dataset.leaderboardView);
    const current = views.indexOf(appState.leaderboardView);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
    event.preventDefault();
    appState.selectLeaderboardView(views[next], true);
  });
  // app-source-end

  // app-source: 463
  let homeLaunchTab = 'all';
  initializeAppState(appState, 'homeLaunchTab', homeLaunchTab);
  // app-source-end

  // app-source: 464
  let homeLaunchWindow = '24h';
  initializeAppState(appState, 'homeLaunchWindow', homeLaunchWindow);
  // app-source-end

  // app-source: 465
  let homeLaunchSort = 'volume';
  initializeAppState(appState, 'homeLaunchSort', homeLaunchSort);
  // app-source-end

  // app-source: 466
  let homeLaunchView = 'grid';
  initializeAppState(appState, 'homeLaunchView', homeLaunchView);
  // app-source-end

  // app-source: 467
  let homeLaunchFilters = appState.emptyHomeLaunchFilters();
  initializeAppState(appState, 'homeLaunchFilters', homeLaunchFilters);
  // app-source-end

  // app-source: 468
  let homeLaunchPaused = false;
  initializeAppState(appState, 'homeLaunchPaused', homeLaunchPaused);
  // app-source-end

  // app-source: 469
  let homeFrozenOrder = null;
  initializeAppState(appState, 'homeFrozenOrder', homeFrozenOrder);
  // app-source-end

  // app-source: 470
  let homeTickerRenderKey = '';
  initializeAppState(appState, 'homeTickerRenderKey', homeTickerRenderKey);
  // app-source-end

  // app-source: 471
  let homeTickerCount = 0;
  initializeAppState(appState, 'homeTickerCount', homeTickerCount);
  // app-source-end

  // app-source: 472
  let homeTickerCycleWidth = 0;
  initializeAppState(appState, 'homeTickerCycleWidth', homeTickerCycleWidth);
  // app-source-end

  // app-source: 473
  let homeTickerFrame = 0;
  initializeAppState(appState, 'homeTickerFrame', homeTickerFrame);
  // app-source-end

  // app-source: 474
  let homeTickerLastFrame = 0;
  initializeAppState(appState, 'homeTickerLastFrame', homeTickerLastFrame);
  // app-source-end

  // app-source: 475
  let homeTickerPauseUntil = 0;
  initializeAppState(appState, 'homeTickerPauseUntil', homeTickerPauseUntil);
  // app-source-end

}
