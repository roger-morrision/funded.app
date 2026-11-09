import { $, node, $$, tabs } from './dom.js';

export function rewards() {
  const root = $('#payments'); if (!root) return;
  const x = node('div'); x.id = 'rewards-x';
  while(root.firstChild) x.append(root.firstChild);
  const overview = node('div'); overview.id = 'rewards-overview';
  overview.innerHTML = `<div class="workspace-page-header rewards-page-header"><p class="eyebrow">Rewards</p><h1>Your participation can pay back.</h1><p>Find eligible rewards, claim available SOL, and track payments.</p></div>
    <section class="reward-upcoming" aria-labelledby="reward-upcoming-title"><header><p class="eyebrow">Plan ahead</p><h2 id="reward-upcoming-title">How to qualify</h2></header><div class="reward-upcoming-grid">
      <article><span>SOL · COIN HOLDERS</span><h3>Hold through the cutoff</h3><ul><li>Choose a coin that shares fees with holders.</li><li>Hold through its displayed hourly cutoff.</li><li>Eligible wallets receive SOL automatically.</li><li>Small pools carry forward to a later payout.</li></ul><button type="button" data-reward-open="holder">View holder rewards →</button></article>
      <article><span>LAUNCHED COIN TOKENS · $RICH HOLDERS</span><h3>Airdrops at migration</h3><ul><li>Hold $RICH until the coin migrates.</li><li>At least 3% of supply is reserved for eligible holders.</li><li>Your share depends on your $RICH holdings.</li><li>Tokens arrive automatically after checks. No claim needed.</li></ul><a href="#airdrops">View airdrops →</a></article>
    </div><ul class="reward-upcoming-note"><li>Claim manually: creator fees, X rewards and three-level referrals.</li><li>Automatic: holder SOL, Daily bonuses and migration airdrops.</li></ul></section>
    <nav class="reward-program-links" aria-label="More reward programs"><a href="#bonuses">Daily bonuses →</a><a href="#referrals">Referral rewards →</a></nav>`;
  overview.addEventListener('focusin',event=>{
    const link=event.target.closest('.reward-upcoming-grid a');
    if(!link||!link.matches(':focus-visible'))return;
    const rect=link.getBoundingClientRect(),nav=document.querySelector('.mobile-workspace-nav');
    const bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
    if(rect.bottom+8>bottom)window.scrollBy({top:Math.ceil(rect.bottom+12-bottom),behavior:'instant'});
  });
  const creator = node('div'); creator.id = 'rewards-creator';
  creator.innerHTML = '<div class="reward-section-intro"><p class="eyebrow">Your launches</p><h2>Creator rewards</h2><p>Earn your saved share of creator fees. Review available claims and confirmed SOL payments.</p></div><div class="reward-creator-gate"><p class="reward-wallet-prompt">Connect your launch wallet to view creator rewards.</p><div class="reward-creator-actions"><button type="button" class="primary-button" data-reward-connect>Connect wallet</button><a class="secondary-button" href="#my-launches">Open Portfolio →</a></div></div>';
  const personal = $('[data-personal-rewards]'); if(personal)creator.append(personal);
  const xSummary = $('[data-x-rewards]',personal || creator);if(xSummary)x.prepend(xSummary);
  const holder = node('div'); holder.id = 'rewards-holder';
  const automatic = $('[data-automatic-rewards]'); if(automatic)holder.append(automatic);
  const topWallets = node('a', 'secondary-button');
  topWallets.href = '#airdrops'; topWallets.textContent = 'View confirmed top recipient wallets →';
  holder.append(topWallets);
  const funded = node('div'); funded.id = 'rewards-funded';
  funded.innerHTML = '<div class="reward-section-intro"><p class="eyebrow">$RICH holders</p><h2>Token airdrops</h2><ul class="guidance-outline"><li>Hold $RICH until the coin migrates.</li><li>Your share is based on eligible $RICH holdings.</li><li>Tokens are paid automatically. No claim needed.</li></ul><a class="primary-button funded-claim-link" href="#airdrops">View airdrops →</a></div>';
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
  const select = tabs(root,[{key:'overview',label:'Overview',panel:overview},{key:'holder',label:'Coin Holder',panel:holder},{key:'funded',label:'Token airdrops',panel:funded},{key:'creator',label:'Coin Creator',panel:creator},{key:'x',label:'X claims',panel:x},{key:'history',label:'All Payout History',panel:history}],'Reward type');
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
