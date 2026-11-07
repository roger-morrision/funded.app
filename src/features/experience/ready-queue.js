import { el, link, utc } from './view-utils.js';
import { rewardDashboardSummary } from './reward-dashboard-model.js';
import { receivedTotal } from './reward-history-model.js';

export function initializeReadyQueue(root, app, onSelect = () => {}) {
  const summary = el('section', null, 'ready-queue reward-dashboard');
  summary.setAttribute('aria-label', 'Your reward status');
  const status = el('p', '', 'reward-dashboard-status'); status.setAttribute('role', 'status');
  const scope = el('p', '', 'reward-dashboard-scope');
  const cards = el('div', null, 'reward-dashboard-cards');
  const specs = [
    ['action', 'Needs action', 'Approvals or uncertain outcomes to review.'],
    ['automatic', 'Processing automatically', 'Tasks with automation enabled. Payment is not yet verified.'],
    ['received', 'Received', 'Verified SOL payment records for this wallet.'],
  ];
  const controls = new Map();
  for (const [key, title, note] of specs) {
    const button = el('button', null, 'reward-dashboard-card'); button.type = 'button';
    button.dataset.rewardGroup = key; button.setAttribute('aria-pressed', 'false');
    const value = el('strong', 'Checking…', 'reward-dashboard-value');
    button.append(el('span', title, 'reward-dashboard-label'), value, el('small', note));
    button.addEventListener('click', () => onSelect(key));
    cards.append(button); controls.set(key, { button, value, title });
  }
  const waiting = el('button', '', 'text-button reward-dashboard-waiting'); waiting.type = 'button';
  waiting.addEventListener('click', () => onSelect('waiting'));
  const connect = el('button', 'Connect wallet', 'primary-button'); connect.type = 'button';
  const total = el('p', '', 'reward-received-total'); total.setAttribute('role','status');
  connect.addEventListener('click', () => document.querySelector('#connect-button')?.click());
  const cutoffNote = el('p', '', 'reward-dashboard-cutoff'); cutoffNote.hidden = true;
  const programs = el('nav', null, 'reward-dashboard-programs'); programs.setAttribute('aria-label', 'Separate reward programs');
  programs.append(link('X claims', '#payments/x'), link('Referrals', '#referrals'), link('Token airdrops', '#airdrops'));
  summary.append(scope, status, cards, total, waiting, connect,
    el('p', 'Counts are loaded records, not balances. Creator approvals can fund other recipients. Token amounts remain in Airdrops.', 'reward-dashboard-note'), programs, cutoffNote);
  root.querySelector('header')?.after(summary);
  const guide = root.querySelector('.financial-help');
  for (const node of root.querySelectorAll(':scope > .flow-stages, :scope > .flow-note')) guide?.append(node);
  return (rows, { checking = false, missing = [], cutoff = null, selected = 'all', range = {} } = {}) => {
    const wallet = app.connectedWalletAddress || '';
    const result = rewardDashboardSummary(rows, wallet, { checking, missing });
    const received = receivedTotal(rows, wallet, {from:range.from,to:range.to});
    total.hidden = !wallet;
    total.textContent = checking ? 'Checking verified SOL receipts…' : range.from && range.to && range.from > range.to ? 'Choose a valid date range to calculate received SOL.'
      : `Verified received: ${result.state === 'partial' && !received.count ? 'Unavailable' : received.amount} · ${range.from || range.to ? 'Selected dates (UTC)' : 'All loaded dates'}${result.state === 'partial' || received.unknown ? ' · Incomplete coverage; total may be higher.' : ''}. Counts above cover all loaded records.`;
    summary.dataset.state = result.state;
    scope.textContent = wallet ? `Your wallet · ${wallet.slice(0, 5)}…${wallet.slice(-5)} · Solana Devnet` : 'Your wallet · Solana Devnet';
    scope.title = wallet;
    status.textContent = result.state === 'disconnected' ? 'Connect your wallet to check its reward records.'
      : result.state === 'checking' ? 'Checking this wallet’s records…'
      : result.state === 'partial' ? 'Some sources are unavailable. Counts with + are incomplete; unavailable does not mean zero.'
      : 'Select a status to filter the records below. X claims and referrals are checked in their own pages.';
    connect.hidden = Boolean(wallet);
    for (const [key, { button, value, title }] of controls) {
      value.textContent = result.count(key); button.disabled = !wallet || checking;
      button.setAttribute('aria-pressed', String(selected === `dashboard-${key}`));
      button.setAttribute('aria-label', `${title}: ${value.textContent}. Filter loaded activity`);
    }
    waiting.hidden = !wallet || checking;
    waiting.textContent = `Waiting for funding or checks: ${result.count('waiting')} · View`;
    waiting.setAttribute('aria-pressed', String(selected === 'dashboard-waiting'));
    cutoffNote.hidden = !cutoff || !wallet;
    cutoffNote.textContent = cutoff && wallet ? `Next bonus cutoff: ${utc(cutoff)}. Payment follows eligibility and verified funding.` : '';
  };
}
