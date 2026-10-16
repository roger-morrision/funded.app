const panel = (prefix, eyebrow, title, description, link = '') => `
  <div class="home-buyback-intro">
    <p class="eyebrow">${eyebrow}</p><h2 id="${prefix === 'home-buyback' ? 'home-buyback-progress-title' : 'buyback-route-title'}">${title}</h2>
    <p id="${prefix}-policy">${description}</p>${link}
  </div>
  <div class="home-buyback-live" aria-live="polite">
    <div class="home-buyback-live-head"><span>Verified SOL eligible for buyback</span><strong id="${prefix}-balance">Checking…</strong></div>
    <div class="home-buyback-track" role="progressbar" aria-label="Eligible buyback progress toward 5 SOL" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0" id="${prefix}-track"><span id="${prefix}-fill"></span></div>
    <div class="home-buyback-live-foot"><span id="${prefix}-status">Checking finalized vault balances</span><span id="${prefix}-trigger">5 SOL trigger</span></div>
    <small id="${prefix}-older" class="home-buyback-older" hidden></small>
    <div class="home-buyback-last"><span>Last verified buy and burn</span><strong id="${prefix}-last-time">No verified burn yet</strong><a id="${prefix}-proof" hidden target="_blank" rel="noopener noreferrer">View transaction ↗</a></div>
  </div>`;

export function mountBuybackProgressPanels(document) {
  const home = document.querySelector('#home-buyback-panel');
  if (home && !home.firstElementChild)
    home.innerHTML = panel('home-buyback', '5% fee route · $FUNDED',
      'Collected fees fund buybacks and burns.',
      'For launches using the published 5% buyback split, that share goes into dedicated on-chain vaults. At 5 SOL in verified vault allocations, the app queues a protected $FUNDED purchase and burn. Execution depends on a verified market quote and available liquidity.',
      '<a href="#buybacks">See buyback receipts →</a>');
  const route = document.querySelector('#buyback-route-panel');
  if (route && !route.firstElementChild)
    route.innerHTML = panel('buyback-route', 'Fee-funded buyback',
      '5 SOL trigger, verified eligible fees.',
      'The published buyback share of collected creator fees remains in dedicated program vaults until verified vault allocations reach the 5 SOL aggregate trigger. The worker then attempts protected $FUNDED purchases and burns; failed market checks leave funds in custody.');
}
