import { $, node, $$, tabs } from './dom.js';

export function rewards() {
  const root = $('#payments'); if (!root) return;
  const x = node('div'); x.id = 'rewards-x';
  while(root.firstChild) x.append(root.firstChild);
  const overview = node('div'); overview.id = 'rewards-overview';
  overview.innerHTML = `<div class="workspace-page-header rewards-page-header"><p class="eyebrow">Rewards</p><h1>Your rewards</h1><p>Claim rewards and track your payments.</p></div>
    <section class="reward-upcoming" aria-labelledby="reward-upcoming-title"><header><p class="eyebrow">Plan ahead</p><h2 id="reward-upcoming-title">When to join, when to wait</h2><p>Recorded cutoffs and targets appear per reward. A target is not a confirmed payment.</p></header><div class="reward-upcoming-grid">
      <article><span>SOL · COIN HOLDERS</span><h3>Hold before the daily snapshot</h3><p>Choose a coin with a holder fee share and hold through its cutoff. Eligible funded cycles pay SOL automatically; small pools can roll forward.</p><button type="button" data-reward-open="holder">See cutoff and payout target →</button></article>
      <article><span>LAUNCHED COIN TOKENS · $FUNDED HOLDERS</span><h3>Hold before that coin migrates</h3><p>Each coin snapshots $FUNDED holders at migration. Once claims open, eligible wallets have 90 days to claim.</p><a href="#airdrops">See airdrops and claim status →</a></article>
    </div><p class="reward-upcoming-note">Creator, X, and referral SOL depend on collected fees. X and referral rewards require a claim when ready.</p></section>
    <div class="reward-overview-start"><p class="eyebrow">Explore rewards</p><h2>Reward programs</h2><p>Each program has its own eligibility and payment status.</p></div>
    <div class="reward-action-grid">
      <button type="button" data-reward-open="x"><span class="reward-action-icon" aria-hidden="true">𝕏</span><span><strong>X account rewards</strong><small>Sign in with X to see and claim your SOL.</small></span><b aria-hidden="true">→</b></button>
      <button type="button" data-reward-open="holder"><span class="reward-action-icon" aria-hidden="true">◎</span><span><strong>Coin holder rewards</strong><small>Eligible coin wallets receive SOL automatically.</small></span><b aria-hidden="true">→</b></button>
      <button type="button" data-reward-open="funded"><span class="reward-action-icon" aria-hidden="true">ƒ</span><span><strong>$FUNDED holder airdrops</strong><small>Check token allocations and claim eligibility.</small></span><b aria-hidden="true">→</b></button>
      <button type="button" data-reward-open="creator"><span class="reward-action-icon" aria-hidden="true">✦</span><span><strong>Creator rewards</strong><small>Claim SOL earned by your launches.</small></span><b aria-hidden="true">→</b></button>
      <button type="button" data-reward-open="history"><span class="reward-action-icon" aria-hidden="true">⇢</span><span><strong>Payment history</strong><small>View confirmed SOL payments.</small></span><b aria-hidden="true">→</b></button>
      <a href="#referrals"><span class="reward-action-icon" aria-hidden="true">↗</span><span><strong>Referral rewards</strong><small>Connect your wallet to check and claim.</small></span><b aria-hidden="true">→</b></a>
    </div>`;
  const creator = node('div'); creator.id = 'rewards-creator';
  creator.innerHTML = '<div class="reward-section-intro"><p class="eyebrow">Your launches</p><h2>Creator rewards</h2><p>Claim SOL from your tokens below.</p></div><div class="reward-creator-gate"><p class="reward-wallet-prompt">Connect your launch wallet to view creator rewards.</p><div class="reward-creator-actions"><button type="button" class="primary-button" data-reward-connect>Connect wallet</button><a class="secondary-button" href="#my-launches">Open Portfolio →</a></div></div>';
  const personal = $('[data-personal-rewards]'); if(personal)creator.append(personal);
  const xSummary = $('[data-x-rewards]',personal || creator);if(xSummary)x.prepend(xSummary);
  const holder = node('div'); holder.id = 'rewards-holder';
  const automatic = $('[data-automatic-rewards]'); if(automatic)holder.append(automatic);
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
  const select = tabs(root,[{key:'overview',label:'My rewards',panel:overview},{key:'holder',label:'Coin holders',panel:holder},{key:'funded',label:'$FUNDED holders',panel:funded},{key:'creator',label:'Creator',panel:creator},{key:'x',label:'X claims',panel:x},{key:'history',label:'Payments',panel:history}],'Reward type');
  root.querySelector(':scope > .ui-tabs')?.after(node('p','reward-tab-hint','Swipe tabs for more reward types →'));
  root.prepend(overview.querySelector('.workspace-page-header'));
  $$('[data-reward-open]',root).forEach(button=>button.addEventListener('click',()=>select(button.dataset.rewardOpen,true)));
  $$('a[href="#payments"]',personal || creator).forEach(link=>link.addEventListener('click',()=>select('x',true)));
  const syncIdentity=()=>{const gate=$('.reward-creator-gate'); if(gate)gate.hidden=Boolean(document.documentElement.dataset.connectedWallet);};
  window.addEventListener('funded:reward-identity-change',syncIdentity); syncIdentity();
}
