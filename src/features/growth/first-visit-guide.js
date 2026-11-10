// First visit: "What brings you here?" → a role checklist with progress on Home.
// Steps reuse the existing role guide; a step counts as done once its page is opened
// (or, for wallet steps, once a wallet is connected). Everything stays in this browser.
import { roleSteps } from '../experience/get-started.js';
import { el, safeStorage } from './format.js';

const ROLE_KEY = 'richpad.guide.role', DONE_KEY = 'richpad.guide.done', HIDE_KEY = 'richpad.guide.hidden';
const ROLES = [
  ['creator', 'Create a coin', 'Launch a token and choose how its fees reward people.'],
  ['holder', 'Earn as a holder', 'Find coins that share fees and airdrops with holders.'],
  ['referrer', 'Invite & earn', 'Share your link and earn from qualifying launches.'],
  ['trader', 'Trade', 'Explore new coins and compete in the Daily bonus.'],
];
const TRADER_STEPS = [['Explore new coins', 'Filter by stage, rewards and activity.', '#explore'], ['Make your first trade', 'Open a coin and buy or sell.', '#explore'], ['Check your Daily bonus rank', 'Top 3 traders each day are paid.', '#bonuses']];

const readDone = () => { try { return new Set(JSON.parse(safeStorage.get(DONE_KEY) || '[]')); } catch { return new Set(); } };
const steps = role => [['Connect your wallet', 'Use the wallet you want to earn with.', 'wallet'], ...(roleSteps[role] || TRADER_STEPS)];

export function mountFirstVisitGuide(app, document = globalThis.document) {
  const anchor = document.querySelector('#main-content > .hero-section');
  if (!anchor || document.getElementById('first-visit-guide')) return Boolean(anchor);
  const panel = el(document, 'section', 'first-visit-guide');
  panel.id = 'first-visit-guide';
  panel.setAttribute('aria-labelledby', 'first-visit-title');
  anchor.after(panel);
  const done = readDone();

  function markVisited() {
    const role = safeStorage.get(ROLE_KEY); if (!role) return;
    for (const [title, , href] of steps(role)) if (href !== 'wallet' && location.hash === href) done.add(title);
    safeStorage.set(DONE_KEY, JSON.stringify([...done]));
  }

  function render() {
    const role = safeStorage.get(ROLE_KEY);
    document.body.dataset.guideRole = role || '';
    if (safeStorage.get(HIDE_KEY) === 'true') { panel.hidden = true; return; }
    panel.hidden = false;
    if (!role) {
      panel.innerHTML = '<header><div><p class="eyebrow">Welcome to richpad.fun</p><h2 id="first-visit-title">What brings you here?</h2></div></header>';
      const grid = el(document, 'div', 'first-visit-roles');
      for (const [key, title, note] of ROLES) {
        const button = el(document, 'button'); button.type = 'button';
        button.append(el(document, 'strong', null, title), el(document, 'small', null, note));
        button.addEventListener('click', () => { safeStorage.set(ROLE_KEY, key); render(); });
        grid.append(button);
      }
      const skip = el(document, 'button', 'text-button first-visit-skip', 'Skip for now'); skip.type = 'button';
      skip.addEventListener('click', () => { safeStorage.set(HIDE_KEY, 'true'); render(); });
      panel.append(grid, skip);
      return;
    }
    const list = steps(role);
    const isDone = ([title, , href]) => href === 'wallet' ? Boolean(app.connectedWalletAddress) : done.has(title);
    const count = list.filter(isDone).length;
    const label = ROLES.find(([key]) => key === role)?.[1] || 'Get started';
    panel.innerHTML = `<header><div><p class="eyebrow">Your checklist · ${label}</p><h2 id="first-visit-title">${count === list.length ? 'All set — nice work.' : `${count} of ${list.length} done`}</h2></div></header>`;
    const bar = el(document, 'div', 'first-visit-progress'); bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(list.length)); bar.setAttribute('aria-valuenow', String(count));
    bar.style.setProperty('--progress', `${Math.round(count / list.length * 100)}%`);
    const ol = el(document, 'ol', 'first-visit-steps');
    for (const step of list) {
      const [title, note, href] = step;
      const item = el(document, 'li'); item.dataset.done = String(isDone(step));
      const action = href === 'wallet' ? el(document, 'button', null, title) : el(document, 'a', null, title);
      if (href === 'wallet') { action.type = 'button'; action.addEventListener('click', () => document.querySelector('#connect-button')?.click()); }
      else action.href = href;
      item.append(action, el(document, 'small', null, note));
      ol.append(item);
    }
    const tools = el(document, 'div', 'first-visit-tools');
    const change = el(document, 'button', 'text-button', 'Change goal'); change.type = 'button';
    change.addEventListener('click', () => { safeStorage.remove(ROLE_KEY); render(); });
    const hide = el(document, 'button', 'text-button', 'Hide checklist'); hide.type = 'button';
    hide.addEventListener('click', () => { safeStorage.set(HIDE_KEY, 'true'); render(); });
    tools.append(change, hide);
    panel.querySelector('header').append(tools);
    panel.append(bar, ol);
  }

  markVisited(); render();
  globalThis.addEventListener?.('hashchange', () => { markVisited(); if (!location.hash || location.hash === '#overview') render(); });
  globalThis.addEventListener?.('funded:reward-identity-change', render);
  return true;
}
