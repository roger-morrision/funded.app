// "See an example": on Devnet many boards are empty. A toggle fills the Daily bonus
// standings and the leaderboard podium with clearly labelled sample data so new users
// understand the page. Nothing is sent anywhere; turning it off restores the real view.
import { renderTodayBonuses } from '../fees/bonus-today-view.js';
import { renderLeaderPodium, clearLeaderPodium } from '../leaderboard/leader-podium.js';
import { el } from './format.js';

const SAMPLE_WALLETS = ['Exa1mpLeWa11et1111111111111111111111111111', 'Exa2mpLeWa11et2222222222222222222222222222', 'Exa3mpLeWa11et3333333333333333333333333333', 'Exa4mpLeWa11et4444444444444444444444444444', 'Exa5mpLeWa11et5555555555555555555555555555'];
export function sampleToday() {
  const rows = scale => SAMPLE_WALLETS.map((wallet, i) => ({ rank: i + 1, wallet, scoreLamports: String(Math.round((5 - i) * scale * 1e9)) }));
  return { today: { creators: rows(1.6), referrals: rows(0.7), traders: rows(12.5), checkedAt: new Date().toISOString() }, schedule: { mode: 'daily' } };
}

function toggle(document, host, { onShow, onHide }) {
  const bar = el(document, 'div', 'example-toggle');
  const note = el(document, 'span', null, 'Nothing here yet on Devnet.');
  const button = el(document, 'button', 'secondary-button', 'See an example'); button.type = 'button';
  let on = false;
  button.addEventListener('click', () => {
    on = !on;
    button.textContent = on ? 'Hide example' : 'See an example';
    note.textContent = on ? 'Example data — not real wallets or payouts.' : 'Nothing here yet on Devnet.';
    bar.dataset.active = String(on);
    (on ? onShow : onHide)();
  });
  bar.append(note, button);
  host.before(bar);
  return bar;
}

export function mountExampleData(document = globalThis.document) {
  let mounted = false;
  const bonuses = document.getElementById('bonuses'), today = bonuses?.querySelector('[data-bonus-today]');
  if (today && !bonuses.querySelector('.example-toggle')) {
    let saved = null;
    const bar = toggle(document, today, {
      onShow: () => { saved = [...today.childNodes]; renderTodayBonuses(bonuses, sampleToday(), document); today.dataset.example = 'true'; },
      onHide: () => { delete today.dataset.example; if (saved) today.replaceChildren(...saved); },
    });
    // Offer the example only while the real standings are empty.
    const sync = () => { bar.hidden = today.dataset.example !== 'true' && !today.querySelector('.bonus-honor-empty-all, .bonus-podium-step.is-open'); };
    new MutationObserver(sync).observe(today, { childList: true }); sync();
    mounted = true;
  }
  const table = document.getElementById('leaderboard-table');
  if (table && !document.querySelector('#leaderboard .example-toggle')) {
    const bar = toggle(document, table, {
      onShow: () => {
        renderLeaderPodium(table, SAMPLE_WALLETS.slice(0, 3).map((wallet, i) => ({ href: '#leaderboard', initials: 'EX', hueKey: wallet, name: `Example ${i + 1}`, sub: 'Sample wallet', value: `${(3 - i) * 4.2} SOL`, valueSub: 'example volume' })), { label: 'Example top 3' });
        table.dataset.example = 'true';
      },
      onHide: () => { delete table.dataset.example; clearLeaderPodium(table); },
    });
    const sync = () => { bar.hidden = table.dataset.example !== 'true' && !table.querySelector('.empty-state'); };
    new MutationObserver(sync).observe(table, { childList: true }); sync();
    mounted = true;
  }
  return mounted;
}
