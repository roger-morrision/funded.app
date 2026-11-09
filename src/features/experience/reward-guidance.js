import { el, link, address } from './view-utils.js';

export const rewardPrograms = [
  ['Coin-holder payments', 'Hold the launched coin at its eligible cutoff', 'SOL', 'Automatic after funding and eligibility checks', '#payments/holders'],
  ['$RICH-holder airdrops', 'Hold $RICH at the verified migration snapshot', 'Launched coin tokens', 'Automatic after migration verification, proportional to your eligible $RICH holdings; check Airdrops', '#airdrops'],
  ['Creator payouts', 'Be the saved launch recipient', 'SOL', 'Claim manually in Rewards → Coin Creator → select coin → Claim creator fees after settlement', '#payments/creator'],
  ['X-linked rewards', 'Own the named X account and link your recipient wallet', 'SOL', 'Sign in to X, check available funds, then claim', '#payments/x'],
  ['Referral payments', 'Be in the launch’s saved upline', 'SOL', 'Claim manually in Referrals after qualifying fee settlement and funding', '#referrals'],
  ['Daily bonuses', 'Rank in a completed bonus window', 'SOL', 'Automatic after cutoff, funded pool and winner checks', '#bonuses'],
];

export function mountRewardGuidance(app) {
  const root = document.querySelector('#rewards-overview');
  if (root) {
    const box = el('section', null, 'flow-panel reward-program-guide');
    const heading = el('h2', 'Which reward can I receive?');heading.id='reward-program-guide-title';
    box.setAttribute('aria-labelledby',heading.id);box.append(heading);
    for (const [name, who, asset, action, href] of rewardPrograms) {
      const row = el('article'), points=el('ul'); points.append(el('li',who),el('li',action)); row.append(link(name, href), el('span', asset, 'reward-program-asset'), points); box.append(row);
    }
    const disclosure=el('details',null,'reward-program-disclosure');
    disclosure.append(el('summary','How each reward program works'),box);root.append(disclosure);
    const dashboard=root.querySelector('#financial-center');if(dashboard)root.prepend(dashboard);
  }
  const mint = new URL(location.href).searchParams.get('airdropMint');
  if (!address(mint) || location.hash !== '#airdrops') return;
  const panel = document.querySelector('#airdrop-selected-program');
  const message = el('p', 'Checking the linked mint’s airdrop…', 'flow-note');
  message.dataset.inlineStatus = ''; message.setAttribute('role', 'status'); panel?.before(message);
  let opened = false;
  const open = () => {
    if (opened || location.hash !== '#airdrops') return;
    const program = app.getAirdropPrograms().find(row => row.id === mint);
    if (!program) { message.textContent = 'The linked mint is not in the loaded airdrop directory. Retry the directory before assuming there is no allocation.'; return; }
    app.renderAirdropProgramDetail(program, {open:true}); opened = true; message.remove();
    void app.loadCommunityReserveStatuses({ mint });
    const title = document.querySelector('#airdrop-selected-title'); title.tabIndex = -1;
    title.focus({preventScroll:true}); panel.scrollIntoView({block:'start'});
  };
  document.addEventListener('funded:verified-search-index', open);
  document.addEventListener('funded:reserves-updated', open);
  open();
}
