import { $, node, $$, tabs } from './dom.js';

export function rewards() {
  const root = $('#payments'); if (!root) return;
  const x = node('div'); x.id = 'rewards-x';
  while(root.firstChild) x.append(root.firstChild);
  const overview = node('div'); overview.id = 'rewards-overview';
  overview.innerHTML = `<div class="workspace-page-header rewards-page-header"><p class="eyebrow">Rewards</p><h1>Your rewards</h1><p>Most SOL rewards arrive automatically. X rewards need a claim.</p></div>
    <section class="reward-upcoming" aria-labelledby="reward-upcoming-title"><header><p class="eyebrow">Plan ahead</p><h2 id="reward-upcoming-title">When to join, when to wait</h2><p>Recorded cutoffs and targets appear per reward. A target is not a confirmed payment.</p></header><div class="reward-upcoming-grid">
      <article><span>SOL · COIN HOLDERS</span><h3>Hold through an hourly cutoff</h3><p>Choose a coin with a holder fee share. An hourly payout needs finalized holdings, a fresh price, eligible wallets, and enough funded SOL. Small pools roll forward. Selected Devnet QA coins use five-minute cycles and reduced minimums; check the coin’s conditions.</p><button type="button" data-reward-open="holder">See cutoff and payout target →</button></article>
      <article><span>LAUNCHED COIN TOKENS · $FUNDED HOLDERS</span><h3>Check each coin’s snapshot and deadline</h3><p>Check each coin’s verified snapshot and published claim deadline on Airdrops. Devnet QA cutoffs are separate; review the coin’s published terms.</p><a href="#airdrops">See snapshots and claim deadlines →</a></article>
    </div><p class="reward-upcoming-note">Creator, X, and referral SOL depend on collected fees. X rewards require a claim. Active automatic routes pay referrals after funding; manual routes can require creator approval. Check finalized receipts.</p></section>
    <nav class="reward-program-links" aria-label="More reward programs"><a href="#bonuses">Daily bonuses →</a><a href="#referrals">Referral rewards →</a></nav>`;
  const creator = node('div'); creator.id = 'rewards-creator';
  creator.innerHTML = '<div class="reward-section-intro"><p class="eyebrow">Your launches</p><h2>Creator rewards</h2><p>Track SOL payments from your launches.</p></div><div class="reward-creator-gate"><p class="reward-wallet-prompt">Connect your launch wallet to view creator rewards.</p><div class="reward-creator-actions"><button type="button" class="primary-button" data-reward-connect>Connect wallet</button><a class="secondary-button" href="#my-launches">Open Portfolio →</a></div></div>';
  const personal = $('[data-personal-rewards]'); if(personal)creator.append(personal);
  const xSummary = $('[data-x-rewards]',personal || creator);if(xSummary)x.prepend(xSummary);
  const holder = node('div'); holder.id = 'rewards-holder';
  const automatic = $('[data-automatic-rewards]'); if(automatic)holder.append(automatic);
  const topWallets = node('a', 'secondary-button');
  topWallets.href = '#airdrops'; topWallets.textContent = 'View confirmed top recipient wallets →';
  holder.append(topWallets);
  const funded = node('div'); funded.id = 'rewards-funded';
  funded.innerHTML = '<div class="reward-section-intro"><p class="eyebrow">$FUNDED holders</p><h2>Token airdrops</h2><p>Hold $FUNDED when a launch sets its eligibility date. Connect that wallet to check your amount and claim status.</p><a class="primary-button funded-claim-link" href="#airdrops">Check eligibility and claim →</a></div>';
  const fundedCard = automatic?.querySelector('.auto-reward-card:nth-child(2)');
  const fundedDirectory = automatic?.querySelector('#funded-holder-token-rewards');
  fundedCard?.remove();
  if(fundedDirectory){
    fundedDirectory.querySelector('header h3').textContent = 'Planned token airdrops';
    fundedDirectory.querySelector('header p').textContent = 'Connect your wallet on Airdrops to check whether you qualify.';
    funded.append(fundedDirectory);
  }
  const holderIntro = automatic?.querySelector('.auto-rewards-intro');
  if(holderIntro)holderIntro.textContent = 'Eligible holders receive SOL automatically. No claim needed.';
  const holderHeading = automatic?.querySelector('.auto-rewards-heading h2');
  if(holderHeading)holderHeading.textContent = 'Coin holder rewards';
  const holderSchedule = automatic?.querySelector('.auto-reward-card');
  holderSchedule?.querySelector('.auto-reward-card-top')?.remove();
  holderSchedule?.querySelector(':scope > p')?.remove();
  const scheduleHeading = holderSchedule?.querySelector('h3');
  if(scheduleHeading)scheduleHeading.textContent = 'Next reward cycle';
  const history = node('div'); history.id = 'rewards-history';
  const historyPanel = $('.x-claim-activity', x); if (historyPanel) history.append(historyPanel);
  root.append(overview,creator,holder,funded,x,history);
  const select = tabs(root,[{key:'overview',label:'My rewards',panel:overview},{key:'holder',label:'Coin holders',panel:holder},{key:'funded',label:'$FUNDED holders',panel:funded},{key:'creator',label:'Creator',panel:creator},{key:'x',label:'X claims',panel:x},{key:'history',label:'History',panel:history}],'Reward type');
  root.prepend(overview.querySelector('.workspace-page-header'));
  $$('[data-reward-open]',root).forEach(button=>button.addEventListener('click',()=>select(button.dataset.rewardOpen,true)));
  for(const tab of root.querySelectorAll(':scope > .ui-tabs > [role="tab"]'))tab.dataset.rewardOpen=tab.getAttribute('aria-controls').replace('rewards-','');
  $$('a[href="#payments"]',personal || creator).forEach(link=>link.addEventListener('click',()=>select('x',true)));
  let historyLocation;
  const syncHistoryRoute=()=>{
    if (historyLocation===location.href) return;
    historyLocation=location.href;
    if (location.hash==='#payments/history') select('history');
    else if (location.hash==='#payments/holders') select('holder');
    else if (location.hash==='#payments/creator') select('creator');
    else if (location.hash==='#payments/x') select('x');
    else if (location.hash==='#payments/activity') select('overview');
  };
  window.addEventListener('funded:route-change',syncHistoryRoute);
  window.addEventListener('hashchange',syncHistoryRoute);
  window.addEventListener('popstate',syncHistoryRoute);
  syncHistoryRoute();
  const syncIdentity=()=>{const gate=$('.reward-creator-gate'); if(gate)gate.hidden=Boolean(document.documentElement.dataset.connectedWallet);};
  window.addEventListener('funded:reward-identity-change',syncIdentity); syncIdentity();
}
