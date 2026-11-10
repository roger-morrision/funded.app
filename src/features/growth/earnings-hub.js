// "My earnings" at the top of Rewards: one total from verified receipts, where to
// claim what needs a signature, and when the next automatic payouts run.
import { el, sol, lamports, getJSON, nextUtcHour, nextUtcMidnight, countdown } from './format.js';

const CLAIMS = [
  ['Creator fees', 'Claim your saved creator-wallet share', '#payments/creator'],
  ['X account rewards', 'Linked X accounts claim their share', '#payments/x'],
  ['Referral rewards', 'Claim funded referral rewards', '#referrals'],
];

export function mountEarningsHub(app, document = globalThis.document) {
  const host = document.querySelector('#payments .rewards-page-header');
  if (!host || document.getElementById('earnings-hub')) return Boolean(host);
  const hub = el(document, 'section', 'earnings-hub');
  hub.id = 'earnings-hub';
  hub.setAttribute('aria-labelledby', 'earnings-hub-title');
  hub.innerHTML = `<div class="earnings-total"><p class="eyebrow">My earnings</p><h2 id="earnings-hub-title" data-earnings-total>—</h2>
    <p class="earnings-total-note" data-earnings-note>Connect a wallet to see what it has earned.</p><div class="earnings-breakdown" data-earnings-breakdown></div></div>
    <div class="earnings-columns"><div><h3>Claim now</h3><ul class="earnings-claims"></ul></div>
    <div><h3>Coming next</h3><ul class="earnings-next" data-earnings-next></ul></div></div>`;
  const claims = hub.querySelector('.earnings-claims');
  for (const [title, note, href] of CLAIMS) {
    const item = el(document, 'li');
    const link = el(document, 'a', null, title); link.href = href;
    item.append(link, el(document, 'small', null, note));
    claims.append(item);
  }
  host.after(hub);
  const total = hub.querySelector('[data-earnings-total]'), note = hub.querySelector('[data-earnings-note]');
  const breakdown = hub.querySelector('[data-earnings-breakdown]'), next = hub.querySelector('[data-earnings-next]');
  let loadedFor = null, serial = 0;

  function renderNext() {
    const now = Date.now();
    next.replaceChildren(...[
      ['Holder SOL rewards', `in ${countdown(nextUtcHour(now), now)}`, 'Automatic each completed UTC hour, when funded'],
      ['Daily bonus snapshot', `in ${countdown(nextUtcMidnight(now), now)}`, 'Top 3 per category paid automatically after checks'],
    ].map(([title, when, detail]) => {
      const item = el(document, 'li');
      item.append(el(document, 'strong', null, title), el(document, 'b', null, when), el(document, 'small', null, detail));
      return item;
    }));
  }

  async function load() {
    const wallet = app.connectedWalletAddress || '';
    if (!wallet) {
      loadedFor = null; total.textContent = '—'; breakdown.replaceChildren();
      note.textContent = 'Connect a wallet to see what it has earned.'; return;
    }
    if (loadedFor === wallet) return;
    loadedFor = wallet; const id = ++serial;
    total.textContent = 'Checking…'; note.textContent = 'Reading verified receipts for this wallet.';
    const data = await getJSON(`/api/rewards/totals?wallet=${encodeURIComponent(wallet)}`);
    if (id !== serial) return;
    const rewards = lamports(data?.rewardsLamports), bonus = lamports(data?.bonusLamports);
    if (rewards == null && bonus == null) {
      total.textContent = 'Unavailable'; note.textContent = 'Verified totals are unavailable right now. Unavailable does not mean zero.';
      breakdown.replaceChildren(); return;
    }
    total.textContent = sol((rewards ?? 0n) + (bonus ?? 0n));
    note.textContent = 'Verified SOL received from holder, creator and Daily bonus payouts. Referral and X rewards are shown on their own pages.';
    const chips = [['Holder & creator SOL', rewards == null ? 'Unavailable' : sol(rewards)], ['Daily bonus', bonus == null ? 'Unavailable' : sol(bonus)]];
    if (Array.isArray(data?.airdrops)) chips.push(['Token airdrops', `${data.airdrops.length} token${data.airdrops.length === 1 ? '' : 's'}`]);
    breakdown.replaceChildren(...chips.map(([label, value]) => {
      const chip = el(document, 'span', 'earnings-chip'); chip.append(el(document, 'small', null, label), el(document, 'b', null, value)); return chip;
    }));
  }

  renderNext(); void load();
  globalThis.setInterval?.(renderNext, 30_000);
  globalThis.addEventListener?.('funded:reward-identity-change', () => { loadedFor = null; void load(); });
  globalThis.addEventListener?.('hashchange', () => { if (location.hash.startsWith('#payments')) void load(); });
  return true;
}
