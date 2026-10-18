const panel = (prefix, eyebrow, title, description, link = '') => `
  <div class="home-buyback-intro">
    <p class="eyebrow">${eyebrow}</p><h2 id="${prefix === 'home-buyback' ? 'home-buyback-progress-title' : 'buyback-route-title'}">${title}</h2>
    <p id="${prefix}-policy">${description}</p>${link}
  </div>
  <div class="home-buyback-live" aria-live="polite">
    <div class="home-buyback-live-head"><span>Verified SOL eligible for buyback</span><strong id="${prefix}-balance">Checking…</strong></div>
    <div class="home-buyback-track" role="progressbar" aria-label="Checking eligible buyback progress" aria-valuetext="Checking verified trigger" id="${prefix}-track"><span id="${prefix}-fill"></span></div>
    <div class="home-buyback-live-foot"><span id="${prefix}-status">Checking finalized vault balances</span><span id="${prefix}-trigger">Checking trigger…</span></div>
    <small id="${prefix}-older" class="home-buyback-older" hidden></small>
    <div class="home-buyback-last"><span>Last verified buy and burn</span><strong id="${prefix}-last-time">Checking burn history…</strong><a id="${prefix}-proof" hidden target="_blank" rel="noopener noreferrer">View transaction ↗</a></div>
  </div>`;

export function mountBuybackProgressPanels(document) {
  const home = document.querySelector('#home-buyback-panel');
  if (home && !home.firstElementChild)
    home.innerHTML = panel('home-buyback', '5% fee route · $FUNDED',
      'Collected fees fund buybacks and burns.',
      'For launches using the published 5% buyback split, that share goes into dedicated on-chain vaults. The verified trigger and eligible balance appear below. Execution depends on a verified market quote and available liquidity.',
      '<a href="#buybacks">See buyback receipts →</a>');
  const route = document.querySelector('#buyback-route-panel');
  if (route && !route.firstElementChild)
    route.innerHTML = panel('buyback-route', 'Fee-funded buyback',
      'Checking verified trigger and eligible fees.',
      'The published buyback share of collected creator fees remains in dedicated program vaults until verified vault allocations reach the current aggregate trigger. The worker then attempts protected $FUNDED purchases and burns; failed market checks leave funds in custody.');
}
