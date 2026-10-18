import { HOME_BONUS_MARKUP, BONUS_HISTORY_MARKUP } from './bonus-dashboard-markup.js';
import { bonusSnapshotLabel, bonusVerificationLabel } from './bonus-labels.js';
const GROUPS = { creators:'Creators', referrals:'Referrers', traders:'Traders' };
const integer = value => /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : null;
export function bonusSol(value) {
  const n = integer(value);
  if (n == null) return 'Unavailable';
  const fraction = String(n % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '');
  return `${n / 1_000_000_000n}${fraction ? `.${fraction}` : ''} SOL`;
}
export function bonusCountdown(cutoff, serverAt, elapsed) {
  const seconds = Math.max(0, Math.ceil((cutoff - serverAt - elapsed) / 1000));
  if (!Number.isFinite(seconds)) return '—:—:—';
  if (!seconds) return 'Snapshot processing';
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
const short = wallet => `${wallet.slice(0, 5)}…${wallet.slice(-5)}`;

export function initBonusDashboard(document = globalThis.document) {
  const anchor = document?.getElementById('home-buyback-panel');
  if (!anchor) return;
  let home = document.getElementById('home-daily-bonuses'), page = document.getElementById('bonuses');
  if (!home) { home = document.createElement('section'); home.id = 'home-daily-bonuses'; anchor.before(home); }
  if (!page) { page = document.createElement('section'); page.id = 'bonuses'; anchor.before(page); }
  if (home.dataset.initialized) return;
  home.dataset.initialized = 'true';
  home.classList.add('home-daily-bonuses'); home.setAttribute('aria-labelledby', 'home-bonus-title');
  page.classList.add('bonus-history-page', 'section-block'); page.setAttribute('aria-labelledby', 'bonuses-title');
  home.innerHTML = HOME_BONUS_MARKUP; page.innerHTML = BONUS_HISTORY_MARKUP;
  const menu = document.querySelector('.nav-more-menu');
  if (menu && !menu.querySelector('a[href="#bonuses"]')) {
    const link = document.createElement('a'); link.className = 'nav-item'; link.href = '#bonuses'; link.textContent = 'Daily bonuses';
    menu.insertBefore(link, menu.querySelector('a[href="#leaderboard"]'));
  }
  const view = document.defaultView, select = page.querySelector('[data-bonus-history-category]');
  const status = page.querySelector('[data-bonus-history-status]'), poolStatus = home.querySelector('[data-bonus-pool-status]');
  const leaders = page.querySelector('[data-bonus-leaders]'), rows = page.querySelector('[data-bonus-history-rows]');
  const previous = page.querySelector('[data-bonus-previous]'), next = page.querySelector('[data-bonus-next]');
  const pageLabel = page.querySelector('[data-bonus-page]'), clock = home.querySelector('[data-bonus-countdown]');
  const frames = new Map(); let request, serial = 0, pageNumber = 1, data, clockBase;
  const node = (tag, text) => { const el = document.createElement(tag); if (text != null) el.textContent = text; return el; };
  const walletLink = wallet => {
    const link = node('a', short(wallet)); link.href = `/wallet/${encodeURIComponent(wallet)}`; link.title = wallet; return link;
  };
  function animate(el, value) {
    if (frames.has(el)) view.cancelAnimationFrame(frames.get(el));
    const to = integer(value), from = integer(el.dataset.amount) ?? 0n;
    if (to == null) { delete el.dataset.amount; el.textContent = 'Unavailable'; el.removeAttribute('aria-label'); return; }
    el.dataset.amount = String(to); el.setAttribute('aria-label', bonusSol(to));
    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden || from === to) { el.textContent = bonusSol(to); return; }
    const start = view.performance.now();
    const step = time => {
      const progress = Math.min(1000, Math.max(0, Math.round((time - start) / 650 * 1000)));
      el.textContent = bonusSol(from + (to - from) * BigInt(progress) / 1000n);
      if (progress < 1000) frames.set(el, view.requestAnimationFrame(step)); else frames.delete(el);
    };
    frames.set(el, view.requestAnimationFrame(step));
  }
  function tick() {
    if (!clockBase) { clock.textContent = '—:—:—'; return; }
    const elapsed = view.performance.now() - clockBase.started;
    if (elapsed > 120_000) { clock.textContent = 'Refresh needed'; return; }
    clock.textContent = bonusCountdown(clockBase.cutoff, clockBase.at, elapsed);
  }
  function render() {
    const qa = data.schedule?.mode === 'devnet-qa-5m' && data.schedule.periodSeconds === 300;
    home.querySelector('[data-bonus-schedule]').textContent = qa
      ? 'Devnet QA: top 3 in each group. Snapshots every 5 minutes for selected test coins.'
      : 'Three leaderboards. Top 3 in each. One snapshot every UTC day.';
    home.querySelector('[data-bonus-cutoff-label]').textContent = qa ? 'Next QA snapshot · every 5 minutes' : 'Next snapshot · 00:00 UTC';
    page.querySelector('[data-bonus-delivery]').textContent = `Creators, referrers and traders share the bonus pool equally. Top 3 in each group receive 50%, 30% and 20%. ${qa ? 'Devnet QA snapshots close every 5 minutes for selected test coins. Standard daily policy remains 24 hours.' : 'Snapshots close at 00:00 UTC.'} Bonuses are paid automatically after snapshot and funding verification. No manual claim or recipient signature is required.`;
    clockBase = { cutoff:Date.parse(data.nextCutoffAt), at:Date.parse(data.serverTime), started:view.performance.now() };
    tick();
    home.querySelector('[data-bonus-verification]').textContent = bonusVerificationLabel(data);
    for (const [key] of Object.entries(GROUPS)) animate(home.querySelector(`[data-bonus-pool="${key}"]`), data.pool?.categoryLamports?.[key]);
    poolStatus.textContent = data.pool?.status === 'verified-indexed-settlements'
      ? `${bonusSnapshotLabel(data.pool.day)} · ${data.pool.collections} verified indexed settlement(s) · checked ${new Date(data.poolCheckedAt).toLocaleTimeString('en-GB', { timeZone:'UTC' })} UTC. Updates every 30 seconds.`
      : 'Today’s settled pool is unavailable. No amount is confirmed here.';
    status.textContent = `${data.snapshots} recorded snapshot(s) · ${data.totalPayments} finalized receipt(s). ${data.unavailableSnapshots ? `${data.unavailableSnapshots} snapshot(s) failed integrity checks and are excluded. ` : ''}${data.unavailableReceipts ? `${data.unavailableReceipts} receipt(s) have unavailable category attribution and are excluded from rankings. ` : ''}${bonusVerificationLabel(data)} A cutoff starts verification; it does not guarantee immediate payment.`;
    leaders.replaceChildren();
    for (const [key, title] of Object.entries(GROUPS)) {
      const group = node('section'); group.append(node('h3', title));
      const list = node('ol'); list.className = 'bonus-wallet-list';
      for (const [index, winner] of data.leaders[key].entries()) {
        const item = node('li'), identity = node('div', `${index + 1}. `);
        identity.append(walletLink(winner.wallet)); item.append(identity, node('span', bonusSol(winner.receivedLamports))); list.append(item);
      }
      group.append(list.children.length ? list : node('p', 'No finalized bonus payout yet.')); leaders.append(group);
    }
    rows.replaceChildren();
    if (!data.history.rows.length) rows.append(node('p', 'No finalized bonus payouts in this category.'));
    else {
      const table = node('table'), head = node('thead'), heading = node('tr');
      for (const title of ['UTC snapshot', 'Wallet', 'Wallet received', 'Creator bonus', 'Referral bonus', 'Trader bonus', 'Receipt']) heading.append(node('th', title));
      head.append(heading); table.append(head); const body = node('tbody');
      for (const receipt of data.history.rows) {
        const tr = node('tr'), snapshot = node('td', bonusSnapshotLabel(receipt.day)); snapshot.title = receipt.day || ''; tr.append(snapshot);
        const wallet = node('td'); wallet.append(walletLink(receipt.wallet)); tr.append(wallet, node('td', bonusSol(receipt.receivedLamports)));
        for (const key of Object.keys(GROUPS)) tr.append(node('td', bonusSol(receipt.categoryLamports?.[key])));
        const proof = node('td'), link = node('a', receipt.signature ? 'Transaction ↗' : 'Payment account ↗');
        link.href = receipt.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; proof.append(link); tr.append(proof); body.append(tr);
      }
      table.append(body); rows.append(table);
    }
    pageNumber = data.history.page; pageLabel.textContent = `Page ${pageNumber} of ${data.history.pages} · ${data.history.total} payments`;
    previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= data.history.pages;
  }
  function unavailable() {
    data = null; clockBase = null; tick();
    for (const el of home.querySelectorAll('[data-bonus-pool]')) animate(el, null);
    poolStatus.textContent = 'Bonus pool data is unavailable. No amount is confirmed here.';
    home.querySelector('[data-bonus-verification]').textContent = 'Current payout readiness is unavailable.';
    status.textContent = 'Bonus history is unavailable. No payout or ranking is confirmed here.';
    leaders.replaceChildren(); rows.replaceChildren(); pageLabel.textContent = ''; previous.disabled = next.disabled = true;
  }
  async function refresh() {
    const id = ++serial; request?.abort(); request = new AbortController();
    const controller = request, timeout = view.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await view.fetch(`/api/daily-bonus/dashboard?category=${select.value}&page=${pageNumber}`, { signal:request.signal, cache:'no-store' });
      if (!response.ok) throw new Error('Unavailable');
      const value = await response.json();
      if (id !== serial) return;
      if (value.cluster !== 'devnet' || value.scope !== 'all-recorded-snapshots'
        || !Number.isFinite(Date.parse(value.serverTime)) || !Number.isFinite(Date.parse(value.nextCutoffAt))
        || !Array.isArray(value.history?.rows) || !Object.keys(GROUPS).every(key => Array.isArray(value.leaders?.[key]))) throw new Error('Invalid bonus response');
      data = value; render();
    } catch { if (id === serial) unavailable(); }
    finally { view.clearTimeout(timeout); }
  }
  const active = () => ['', '#overview', '#bonuses'].includes(view.location.hash) && !document.hidden;
  const route = () => { if (active()) void refresh(); };
  const changeCategory = () => { pageNumber = 1; rows.replaceChildren(); status.textContent = 'Checking selected bonus history…'; void refresh(); };
  select.addEventListener('change', changeCategory);
  previous.addEventListener('click', () => { pageNumber--; void refresh(); });
  next.addEventListener('click', () => { pageNumber++; void refresh(); });
  page.querySelector('[data-bonus-history-refresh]').addEventListener('click', () => { void refresh(); });
  for (const link of home.querySelectorAll('[data-bonus-category-link]')) link.addEventListener('click', () => {
    select.value = link.dataset.bonusCategoryLink; pageNumber = 1;
  });
  view.addEventListener('hashchange', route); document.addEventListener('visibilitychange', route);
  const clockTimer = view.setInterval(() => { if (active()) tick(); }, 1000);
  const refreshTimer = view.setInterval(route, 30_000);
  route();
  return () => {
    ++serial; request?.abort(); view.clearInterval(clockTimer); view.clearInterval(refreshTimer);
    for (const frame of frames.values()) view.cancelAnimationFrame(frame);
    view.removeEventListener('hashchange', route); document.removeEventListener('visibilitychange', route);
  };
}
