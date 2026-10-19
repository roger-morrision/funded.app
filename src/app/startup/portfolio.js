// Startup runs in the order declared in start.js.
export function initializePortfolio(appState) {
  // app-source: 940
  document.querySelector('.portfolio-view-tabs')?.addEventListener('click', event => {
    const button = event.target.closest('[data-portfolio-tab]');
    if (button) appState.activatePortfolioTab(button.dataset.portfolioTab);
  });
  // app-source-end

  // app-source: 941
  document.querySelector('.portfolio-view-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll('[data-portfolio-tab]')];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    appState.activatePortfolioTab(tabs[next].dataset.portfolioTab, true);
  });
  // app-source-end

  // app-source: 942
  document.querySelector('#portfolio-refresh')?.addEventListener('click', () => { void appState.refreshPortfolioHoldings(); });
  document.querySelector('#portfolio-trades-refresh')?.addEventListener('click', () => { void appState.refreshPortfolioTrades(); });
  appState.createRoutePoller({run:()=>appState.refreshPortfolioTrades(),
    active:()=>Boolean(appState.connectedWalletAddress)&&!appState.coinRouteRequested()
      && appState.requestedPageRoute()==='my-launches',intervalMs:60_000});
  // app-source-end

}
