import { el, link, address } from './view-utils.js';

export const rewardPrograms = [
  ['Coin-holder payments', 'Hold the launched coin at its eligible cutoff', 'SOL', 'Automatic after funding and eligibility checks', '#payments/holders'],
  ['$FUNDED-holder airdrops', 'Hold $FUNDED at the verified migration snapshot', 'Launched coin tokens', 'Check the mint and claim before its deadline', '#airdrops'],
  ['Creator payouts', 'Be the saved launch recipient', 'SOL', 'Automatic route or creator approval shown on the coin', '#payments/creator'],
  ['X-linked rewards', 'Own the named X account and link your recipient wallet', 'SOL', 'Sign in to X, check available funds, then claim', '#payments/x'],
  ['Referral payments', 'Be in the launch’s saved upline', 'SOL', 'Automatic after qualifying fee settlement and funding', '#referrals'],
  ['Daily bonuses', 'Rank in a completed bonus window', 'SOL', 'Automatic after cutoff, funded pool and winner checks', '#bonuses'],
];

export function mountRewardGuidance(app) {
  const root = document.querySelector('#rewards-overview');
  if (root) {
    const box = el('details', null, 'flow-panel reward-program-guide');
    box.dataset.inlineStatus = ''; box.open = true;
    box.append(el('summary', 'Which reward can I receive?'));
    for (const [name, who, asset, action, href] of rewardPrograms) {
      const row = el('article'); row.append(link(name, href), el('p', `${who}. Receive ${asset}. ${action}.`)); box.append(row);
    }
    root.prepend(box);
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
