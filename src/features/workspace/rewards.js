import { $, node, $$, tabs } from './dom.js';

// Rewards page: two views. Earnings = one expandable row per reward type (each
// holds that type's existing panel); History = one payment list with Mine / All.
export function rewards() {
  const root = $('#payments'); if (!root) return;
  const x = node('div'); x.id = 'rewards-x';
  while(root.firstChild) x.append(root.firstChild);
  const overview = node('div'); overview.id = 'rewards-overview';
  overview.innerHTML = `<div class="workspace-page-header rewards-page-header"><div class="rewards-title-row"><h1>Rewards</h1><a class="rewards-help-link" href="#docs/reward-actions">How rewards work</a></div><p>Claim what you have earned and see every payment.</p></div>
    <section class="reward-upcoming" aria-labelledby="reward-upcoming-title"><header><p class="eyebrow">Plan ahead</p><h2 id="reward-upcoming-title">How to qualify</h2></header><div class="reward-upcoming-grid">
      <article><span>SOL · COIN HOLDERS</span><h3>Hold through the cutoff</h3><ul><li>Choose a coin that shares fees with holders.</li><li>Hold through its displayed hourly cutoff.</li><li>Eligible wallets receive SOL automatically.</li><li>Small pools carry forward to a later payout.</li></ul><button type="button" data-reward-open="holder">View holder rewards →</button></article>
      <article><span>LAUNCHED COIN TOKENS · $RICH HOLDERS</span><h3>Airdrops at migration</h3><ul><li>Hold $RICH until the coin migrates.</li><li>At least 3% of supply is reserved for eligible holders.</li><li>Your share depends on your $RICH holdings.</li><li>Tokens arrive automatically after checks. No claim needed.</li></ul><a href="#airdrops">View airdrops →</a></article>
    </div><ul class="reward-upcoming-note"><li>Claim manually: creator fees, X rewards and three-level referrals.</li><li>Automatic: holder SOL, Daily bonuses and migration airdrops.</li></ul></section>`;
  overview.addEventListener('focusin',event=>{
    const link=event.target.closest('.reward-upcoming-grid a');
    if(!link||!link.matches(':focus-visible'))return;
    const rect=link.getBoundingClientRect(),nav=document.querySelector('.mobile-workspace-nav');
    const bottom=nav?.getClientRects().length?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;
    if(rect.bottom+8>bottom)window.scrollBy({top:Math.ceil(rect.bottom+12-bottom),behavior:'instant'});
  });
  // The wallet prompt lives once, in the earnings card; panels don't repeat it.
  const creator = node('div'); creator.id = 'rewards-creator';
  creator.innerHTML = '<div class="reward-section-intro"><p class="eyebrow">Your launches</p><h2>Creator rewards</h2><p>Earn your saved share of creator fees. Review available claims and confirmed SOL payments.</p></div><div class="reward-creator-gate"><div class="reward-creator-actions"><a class="secondary-button" href="#my-launches">Open Portfolio →</a></div></div>';
  const personal = $('[data-personal-rewards]'); if(personal)creator.append(personal);
  const xSummary = $('[data-x-rewards]',personal || creator);if(xSummary)x.prepend(xSummary);
  const holder = node('div'); holder.id = 'rewards-holder';
  const automatic = $('[data-automatic-rewards]'); if(automatic)holder.append(automatic);
  const topWallets = node('a', 'secondary-button');
  topWallets.href = '#airdrops'; topWallets.textContent = 'View token airdrops →';
  holder.append(topWallets);
  const fundedCard = automatic?.querySelector('.auto-reward-card:nth-child(2)');
  const fundedDirectory = automatic?.querySelector('#funded-holder-token-rewards');
  fundedCard?.remove();
  if(fundedDirectory){
    fundedDirectory.querySelector('header h3').textContent = 'Planned token airdrops';
    fundedDirectory.querySelector('header p').textContent = 'Connect your wallet on Airdrops to check whether you qualify.';
    holder.append(fundedDirectory);
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

  // History: Mine = the connected wallet's recorded activity (#financial-center
  // mounts into it); All = public confirmed payouts. No wallet → All only.
  const history = node('div'); history.id = 'rewards-history';
  const historyMine = node('div'); historyMine.id = 'rewards-history-mine';
  const historyAll = node('div'); historyAll.id = 'rewards-history-all';
  const historyPanel = $('.x-claim-activity', x); if (historyPanel) historyAll.append(historyPanel);
  const scopeBar = node('div', 'segmented rewards-history-scope'); scopeBar.setAttribute('role', 'group'); scopeBar.setAttribute('aria-label', 'Whose payments');
  scopeBar.innerHTML = '<button type="button" data-history-scope="mine">Mine</button><button type="button" data-history-scope="all">All</button>';
  history.append(scopeBar, historyMine, historyAll);
  let historyScope = null;
  const showHistory = scope => {
    const wallet = Boolean(document.documentElement.dataset.connectedWallet);
    if (scope) historyScope = scope;
    const shown = wallet ? historyScope || 'mine' : 'all';
    scopeBar.hidden = !wallet; historyMine.hidden = shown !== 'mine'; historyAll.hidden = shown !== 'all';
    for (const button of scopeBar.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.historyScope === shown));
  };
  scopeBar.addEventListener('click', event => { const button = event.target.closest('[data-history-scope]'); if (button) showHistory(button.dataset.historyScope); });

  // Earnings: one row per reward type.
  const rows = node('div', 'earnings-rows');
  const row = (key, title, note, panel) => {
    const details = node('details', 'earnings-row'); details.id = `rewards-row-${key}`; details.dataset.rewardRow = key;
    const summary = node('summary');
    summary.append(node('strong', '', title), node('small', '', note), node('span', 'earnings-row-action', 'Open'));
    details.append(summary, panel); rows.append(details);
  };
  row('creator', 'Creator fees', 'Your saved share of creator fees · claim', creator);
  row('x', 'X account rewards', 'Rewards linked to your X account · claim', x);
  row('holder', 'Holder rewards', 'SOL to coin holders and $RICH airdrops · automatic', holder);
  const referral = node('a', 'earnings-row earnings-row-link'); referral.href = '#referrals';
  referral.append(node('strong', '', 'Referral rewards'), node('small', '', 'From creators you invited · claim on Referrals'), node('span', 'earnings-row-action', 'Open →'));
  rows.append(referral);
  overview.append(rows);
  root.append(overview,history);
  const select = tabs(root,[{key:'overview',label:'Earnings',panel:overview},{key:'history',label:'History',panel:history}],'Rewards view');
  root.prepend(overview.querySelector('.workspace-page-header'));
  const openRow = (key, focus = false) => {
    select('overview');
    const details = $(`#rewards-row-${key}`); if (!details) return;
    details.open = true;
    if (focus) { details.querySelector('summary')?.focus({ preventScroll:true }); details.scrollIntoView({ block:'start' }); }
  };
  const open = (key, focus) => {
    if (key === 'history') { select('history', focus); showHistory(); }
    else if (key === 'overview') select('overview', focus);
    else openRow(key, focus);
  };
  $$('[data-reward-open]',root).forEach(button=>button.addEventListener('click',()=>open(button.dataset.rewardOpen,true)));
  for(const tab of root.querySelectorAll(':scope > .ui-tabs > [role="tab"]'))tab.dataset.rewardOpen=tab.getAttribute('aria-controls').replace('rewards-','');
  $$('a[href="#payments"]',personal || creator).forEach(link=>link.addEventListener('click',()=>openRow('x',true)));
  let historyLocation;
  const syncHistoryRoute=()=>{
    if (historyLocation===location.href) return;
    historyLocation=location.href;
    if (location.hash==='#payments/history') { select('history'); showHistory('all'); }
    else if (location.hash==='#payments/activity') { select('history'); showHistory('mine'); }
    else if (location.hash==='#payments/holders') openRow('holder', true);
    else if (location.hash==='#payments/creator') openRow('creator', true);
    else if (location.hash==='#payments/x') openRow('x', true);
  };
  window.addEventListener('funded:route-change',syncHistoryRoute);
  window.addEventListener('hashchange',syncHistoryRoute);
  window.addEventListener('popstate',syncHistoryRoute);
  syncHistoryRoute();
  window.addEventListener('funded:reward-identity-change',()=>showHistory()); showHistory();
}
