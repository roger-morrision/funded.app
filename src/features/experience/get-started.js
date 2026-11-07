import { el, link, button } from './view-utils.js';

export const roleSteps = {
  creator: [['Prepare your coin', 'Choose a name, image and reward allocation.', '#launch'], ['Review and launch', 'Check the SOL budget, then verify the mint and fee route.', '#launch'], ['Manage creator rewards', 'Review settlements and any approval needed.', '#payments/creator']],
  holder: [['Explore eligible coins', 'Read the coin’s reward rules before buying.', '#explore'], ['Check your holdings', 'Review balances and confirmed trade receipts.', '#my-launches'], ['Track rewards', 'Check cutoffs, funding and verified payments.', '#payments/holders']],
  referrer: [['Create your referral link', 'Connect your wallet and review attribution rules.', '#referrals'], ['Share your link', 'Use the copy and share controls in Referrals.', '#referrals'], ['Review referral rewards', 'Check funded rewards and any claim available.', '#referrals']],
};

export function mountGetStarted(app) {
  const board = document.querySelector('.home-launch-board');
  if (!board || document.querySelector('#get-started')) return;
  const root = el('details', null, 'get-started'); root.id = 'get-started';
  root.append(el('summary', 'Get started · Creator, holder or referrer'));
  const label = el('label', 'I want to get started as a');
  const select = el('select');
  for (const role of Object.keys(roleSteps)) { const option = el('option', role[0].toUpperCase()+role.slice(1)); option.value = role; select.append(option); }
  label.append(select);
  const wallet = el('p', null, 'get-started-wallet'), status = el('span'); status.setAttribute('role', 'status');
  const connect = button('Connect wallet', async () => {
    connect.disabled = true;
    try { await app.connectWallet(); syncWallet(); }
    catch { status.textContent = 'Connection cancelled or unavailable. Try again when ready.'; }
    finally { connect.disabled = false; }
  });
  wallet.append(status, connect);
  const list = el('ol');
  function render() {
    list.replaceChildren(...roleSteps[select.value].map(([title, text, href]) => { const row = el('li'); row.append(link(title, href), el('p', text)); return row; }));
  }
  function syncWallet() {
    const address = app.connectedWalletAddress;
    status.textContent = address ? `Wallet connected · ${address.slice(0,4)}…${address.slice(-4)}` : 'First, connect the wallet you want to use.';
    connect.hidden = Boolean(address);
  }
  select.addEventListener('change', render); window.addEventListener('funded:reward-identity-change', syncWallet);
  root.append(label, wallet, list, el('small', 'A guide to your next actions. Completion is verified in each feature.'));
  board.before(root); render(); syncWallet();
}
