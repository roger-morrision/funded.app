// "My earnings" at the top of Rewards: one total from verified receipts, where to
// claim what needs a signature, and when the next automatic payouts run.
import { el, sol, lamports, getJSON, nextUtcHour, nextUtcMidnight, countdown } from './format.js';

export function mountEarningsHub(app, document = globalThis.document) {
  const host = document.querySelector('#payments .rewards-page-header');
  if (!host || document.getElementById('earnings-hub')) return Boolean(host);
  const hub = el(document, 'section', 'earnings-hub');
  hub.id = 'earnings-hub';
  hub.setAttribute('aria-labelledby', 'earnings-hub-title');
  hub.innerHTML = `<div class="earnings-total"><p class="eyebrow">My earnings</p><h2 id="earnings-hub-title" data-earnings-total>—</h2>
    <p class="earnings-total-note" data-earnings-note>Connect a wallet to see what it has earned.</p>
    <button type="button" class="primary-button earnings-connect" data-earnings-connect>Connect wallet</button><div class="earnings-breakdown" data-earnings-breakdown></div></div>
    <div class="earnings-columns"><div><h3>Coming next</h3><ul class="earnings-next" data-earnings-next></ul></div></div>`;
  // The page's only wallet prompt; each reward row below opens its own claim panel.
  const connect = hub.querySelector('[data-earnings-connect]');
  connect.addEventListener('click', () => document.querySelector('#connect-button')?.click());
  host.after(hub);
  const total = hub.querySelector('[data-earnings-total]'), note = hub.querySelector('[data-earnings-note]');
  const breakdown = hub.querySelector('[data-earnings-breakdown]'), next = hub.querySelector('[data-earnings-next]');
  let loadedFor = null, loadedAt = 0, serial = 0;

  // A countdown only for payouts that actually run; otherwise say they are not active.
  // null = not yet known (countdown shown as before).
  const running = { holder: null, bonus: null };
  void getJSON('/api/rewards/automatic').then(data => { running.holder = data ? data.status === 'active' : null; renderNext(); });
  void getJSON('/api/daily-bonus').then(data => { running.bonus = data ? data.payoutEnabled === true : null; renderNext(); });
  function renderNext() {
    const now = Date.now();
    const off = 'Not active yet';
    next.replaceChildren(...[
      ['Holder SOL rewards', running.holder === false ? off : `in ${countdown(nextUtcHour(now), now)}`,
        running.holder === false ? 'Starts when automatic holder payouts are switched on' : 'Automatic each completed UTC hour, from that hour’s collected fees'],
      ['Daily bonus snapshot', running.bonus === false ? off : `in ${countdown(nextUtcMidnight(now), now)}`,
        running.bonus === false ? 'Starts when daily bonus payouts are switched on' : 'Top 3 per category paid automatically after checks'],
    ].map(([title, when, detail]) => {
      const item = el(document, 'li');
      item.append(el(document, 'strong', null, title), el(document, 'b', null, when), el(document, 'small', null, detail));
      return item;
    }));
  }

  async function load() {
    const wallet = app.connectedWalletAddress || '';
    connect.hidden = Boolean(wallet);
    if (!wallet) {
      serial++;
      loadedFor = null; total.textContent = '—'; breakdown.replaceChildren();
      note.textContent = 'Connect a wallet to see what it has earned.'; return;
    }
    if (loadedFor === wallet && Date.now() - loadedAt < 60_000) return;
    loadedFor = wallet; loadedAt = Date.now(); const id = ++serial;
    total.textContent = 'Checking…'; note.textContent = 'Reading verified receipts for this wallet.';
    breakdown.replaceChildren();
    const data = await getJSON(`/api/rewards/totals?wallet=${encodeURIComponent(wallet)}`);
    if (id !== serial || app.connectedWalletAddress !== wallet) return;
    const rewards = lamports(data?.rewardsLamports), bonus = lamports(data?.bonusLamports);
    if (rewards == null && bonus == null) {
      loadedFor = null;
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
  globalThis.setInterval?.(() => { if (!document.hidden && /^#(payments|rewards)/.test(location.hash)) void load(); }, 60_000);
  globalThis.addEventListener?.('funded:reward-identity-change', () => { loadedFor = null; void load(); });
  globalThis.addEventListener?.('hashchange', () => { if (/^#(payments|rewards)/.test(location.hash)) void load(); });
  return true;
}
