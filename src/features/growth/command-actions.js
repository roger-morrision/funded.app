// Ctrl K: besides coins, match pages and actions ("claim", "invite", "create").
import { el } from './format.js';

export const ACTIONS = [
  ['Create a coin', '#launch', 'launch new token create'],
  ['Claim creator fees', '#payments/creator', 'claim creator rewards fees'],
  ['Claim X account rewards', '#payments/x', 'claim x twitter account'],
  ['Get my invite link', '#referrals', 'invite referral link share earn'],
  ['My earnings', '#payments', 'earnings rewards received payouts claim'],
  ['Daily bonus standings', '#bonuses', 'daily bonus rank winners podium'],
  ['Leaderboard', '#leaderboard', 'leaderboard top traders burners creators'],
  ['Top 100 tokens', '#top100', 'top 100 rankings'],
  ['Portfolio', '#my-launches', 'portfolio holdings projects locked'],
  ['Airdrops', '#airdrops', 'airdrops allocations rich holders'],
  ['Burn $RICH', '#buybacks', 'burn rich buyback'],
  ['Fee distribution', '#capital-flow', 'fee distribution split policy'],
  ['Get listed', '#list', 'list listing external token'],
  ['Wallet & preferences', '#profile', 'profile wallet settings notifications alerts'],
  ['Service status', '#status', 'status health workers uptime'],
  ['Docs & help', '#docs', 'docs help guide faq'],
];

export function matchActions(query, limit = 5) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ACTIONS.filter(([title, , keywords]) => words.every(word => `${title} ${keywords}`.toLowerCase().includes(word))).slice(0, limit);
}

export function mountCommandActions(document = globalThis.document) {
  const dialog = document.getElementById('header-search-dialog');
  const input = document.getElementById('header-search-input');
  const head = dialog?.querySelector('.header-search-results-head');
  if (!dialog || !input || !head || document.getElementById('header-search-actions')) return Boolean(dialog);
  const box = el(document, 'nav', 'header-search-actions'); box.id = 'header-search-actions'; box.setAttribute('aria-label', 'Pages and actions'); box.hidden = true;
  head.before(box);
  const render = () => {
    const matches = matchActions(input.value);
    box.hidden = !matches.length;
    box.replaceChildren(el(document, 'strong', null, 'Pages & actions'), ...matches.map(([title, href]) => {
      const link = el(document, 'a', null, title); link.href = href;
      link.addEventListener('click', () => dialog.close?.());
      return link;
    }));
  };
  input.addEventListener('input', render);
  dialog.addEventListener('close', () => { box.hidden = true; });
  return true;
}
