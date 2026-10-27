import { HOME_BONUS_MARKUP, BONUS_HISTORY_MARKUP } from './bonus-dashboard-markup.js';
import { bonusSnapshotLabel, bonusVerificationLabel } from './bonus-labels.js';
import {bonusCategoryCopy} from './fee-policy-copy.js';
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
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
// Match only producer-supported typed identities, never a wallet or row position alone.
const receiptAliases = receipt => !ADDRESS.test(receipt.wallet || '') ? [] : [
  SIGNATURE.test(receipt.signature || '') && JSON.stringify([receipt.wallet, 'tx', receipt.signature]),
  ADDRESS.test(receipt.paymentAccount || '') && JSON.stringify([receipt.wallet, 'account', receipt.paymentAccount]),
].filter(Boolean);

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
  let historyGeneration = 0, historyState, historyHash = view.location.hash;
  const forgetHistoryOwner = () => { historyGeneration++; historyState = undefined; };
  const historyOwner = () => ({ generation:historyGeneration, hash:view.location.hash, category:select.value, page:pageNumber });
  const currentHistoryOwner = owner => owner?.hash === '#bonuses' && view.location.hash === owner.hash
    && Number.isSafeInteger(owner.page) && owner.page >= 1
    && historyGeneration === owner.generation && select.value === owner.category && pageNumber === owner.page;
  const sameHistoryOwner = (a, b) => a && b && a.generation === b.generation && a.hash === b.hash
    && a.category === b.category && a.page === b.page;
  function updateHistoryRecord(record, receipt) {
    const cells = record.tr.children;
    cells[0].textContent = bonusSnapshotLabel(receipt.day); cells[0].title = receipt.day || '';
    record.recipient.textContent = short(receipt.wallet);
    record.recipient.href = `/wallet/${encodeURIComponent(receipt.wallet)}`; record.recipient.title = receipt.wallet;
    cells[2].textContent = bonusSol(receipt.receivedLamports);
    Object.keys(GROUPS).forEach((key, index) => { cells[index + 3].textContent = bonusSol(receipt.categoryLamports?.[key]); });
    record.proof.textContent = receipt.signature ? 'Transaction ↗' : 'Payment account ↗';
    record.proof.href = receipt.href; record.proof.target = '_blank'; record.proof.rel = 'noopener noreferrer';
    record.aliases = receiptAliases(receipt);
  }
  function newHistoryRecord(receipt) {
    const tr = node('tr'); for (let i = 0; i < 7; i++) tr.append(node('td'));
    const recipient = walletLink(receipt.wallet), proof = node('a');
    tr.children[1].append(recipient); tr.children[6].append(proof);
    const record = { tr, recipient, proof }; updateHistoryRecord(record, receipt); return record;
  }
  function matchHistoryRecords(previous, incoming) {
    const index = records => {
      const map = new Map(); records.forEach((record, i) => record.aliases.forEach(alias => {
        if (!map.has(alias)) map.set(alias, []); map.get(alias).push(i);
      })); return map;
    };
    const oldIndex = index(previous), nextIndex = index(incoming), oldEdges = previous.map(() => new Set());
    const nextEdges = incoming.map(() => new Set()), ambiguous = new Set();
    for (const [alias, next] of nextIndex) {
      const old = oldIndex.get(alias) || [];
      if (next.length > 1 || old.length > 1) { next.forEach(i => ambiguous.add(i)); }
      for (const n of next) for (const o of old) { nextEdges[n].add(o); oldEdges[o].add(n); }
    }
    return incoming.map((record, i) => {
      if (ambiguous.has(i) || nextEdges[i].size !== 1) return undefined;
      const [old] = nextEdges[i];
      // A bridge/split cannot choose one of several old or new receipt owners.
      if (oldEdges[old].size !== 1 || previous[old].aliases.some(alias => (oldIndex.get(alias)?.length || 0) > 1)) return undefined;
      return previous[old];
    });
  }
  function mutateHistory(owner, eligible, mutate) {
    const original = document.activeElement;
    const owned = eligible && currentHistoryOwner(owner) && sameHistoryOwner(historyState?.owner, owner)
      && document.hasFocus() && original?.isConnected && rows.contains(original)
      && historyState.records.some(record => record.recipient === original);
    let intervened = false;
    const focusChanged = event => { if (event.target !== original && event.target !== document.body) intervened = true; };
    if (owned) document.addEventListener('focusin', focusChanged, true);
    try {
      mutate();
      if (owned && !original.isConnected && !intervened && document.activeElement === document.body
        && currentHistoryOwner(owner) && document.hasFocus() && !document.hidden
        && select.isConnected && !select.disabled && select.getClientRects().length
        && view.getComputedStyle(select).visibility === 'visible') select.focus({ preventScroll:true });
    } finally { if (owned) document.removeEventListener('focusin', focusChanged, true); }
  }
  function renderHistory(owner) {
    const history = data.history;
    const eligible = currentHistoryOwner(owner) && history.category === owner.category && history.page === owner.page;
    const retained = eligible && sameHistoryOwner(historyState?.owner, owner)
      && historyState.table.isConnected && historyState.table.parentElement === rows;
    mutateHistory(owner, eligible, () => {
      if (!history.rows.length) {
        rows.replaceChildren(node('p', 'No finalized bonus payouts in this category.')); historyState = undefined; return;
      }
      let table, body;
      if (retained) ({ table, body } = historyState);
      else {
        table = node('table'); const head = node('thead'), heading = node('tr');
        for (const title of ['UTC snapshot', 'Wallet', 'Wallet received', 'Creator bonus', 'Referral bonus', 'Trader bonus', 'Receipt']) heading.append(node('th', title));
        head.append(heading); body = node('tbody'); table.append(head, body);
      }
      const previousRecords = retained ? historyState.records : [];
      const matched = matchHistoryRecords(previousRecords, history.rows.map(receipt => ({ aliases:receiptAliases(receipt) })));
      const records = history.rows.map((receipt, index) => {
        const record = matched[index] || newHistoryRecord(receipt); if (matched[index]) updateHistoryRecord(record, receipt); return record;
      });
      const keep = new Set(records.map(record => record.tr));
      for (const record of previousRecords) if (!keep.has(record.tr)) record.tr.remove();
      // An ordinary DOM move of a focused ancestor loses focus in supported browsers.
      // Leave that row attached and realize the new order by moving its siblings.
      const fixed = records.findIndex(record => record.tr.contains(document.activeElement));
      if (fixed >= 0) {
        let cursor = body.firstElementChild;
        for (let i = 0; i < fixed; i++) {
          const tr = records[i].tr; if (tr !== cursor) body.insertBefore(tr, cursor); cursor = tr.nextElementSibling;
        }
        cursor = records[fixed].tr.nextElementSibling;
        for (let i = fixed + 1; i < records.length; i++) {
          const tr = records[i].tr; if (tr !== cursor) body.insertBefore(tr, cursor); cursor = tr.nextElementSibling;
        }
      } else {
        let cursor = body.firstElementChild;
        for (const { tr } of records) { if (tr !== cursor) body.insertBefore(tr, cursor); cursor = tr.nextElementSibling; }
      }
      if (!retained) rows.replaceChildren(table);
      historyState = { table, body, records, owner:eligible ? owner : undefined };
    });
  }
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
  function render(owner) {
    const qa = data.schedule?.mode === 'devnet-qa-5m' && data.schedule.periodSeconds === 300;
    home.querySelector('[data-bonus-schedule]').textContent = qa
      ? 'Devnet QA: top 3 in each group. Snapshots every 5 minutes for selected test coins.'
      : 'Three leaderboards. Top 3 in each. One snapshot every UTC day.';
    home.querySelector('[data-bonus-cutoff-label]').textContent = qa ? 'Next QA snapshot · every 5 minutes' : 'Next snapshot · 00:00 UTC';
    page.querySelector('[data-bonus-delivery]').textContent = `${bonusCategoryCopy()} ${qa ? 'Devnet QA snapshots close every 5 minutes for selected test coins. Standard daily policy remains 24 hours.' : 'Snapshots close at 00:00 UTC.'} Bonuses are paid automatically after snapshot and funding verification. No manual claim or recipient signature is required.`;
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
    renderHistory(owner);
    pageNumber = data.history.page; pageLabel.textContent = `Page ${pageNumber} of ${data.history.pages} · ${data.history.total} payments`;
    previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= data.history.pages;
  }
  function unavailable(owner) {
    data = null; clockBase = null; tick();
    for (const el of home.querySelectorAll('[data-bonus-pool]')) animate(el, null);
    poolStatus.textContent = 'Bonus pool data is unavailable. No amount is confirmed here.';
    home.querySelector('[data-bonus-verification]').textContent = 'Current payout readiness is unavailable.';
    status.textContent = 'Bonus history is unavailable. No payout or ranking is confirmed here.';
    leaders.replaceChildren();
    mutateHistory(owner, true, () => { rows.replaceChildren(); historyState = undefined; });
    pageLabel.textContent = ''; previous.disabled = next.disabled = true;
  }
  async function refresh() {
    const id = ++serial; request?.abort(); request = new AbortController();
    const owner = historyOwner();
    const controller = request, timeout = view.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await view.fetch(`/api/daily-bonus/dashboard?category=${select.value}&page=${pageNumber}`, { signal:request.signal, cache:'no-store' });
      if (!response.ok) throw new Error('Unavailable');
      const value = await response.json();
      if (id !== serial) return;
      if (value.cluster !== 'devnet' || value.scope !== 'all-recorded-snapshots'
        || !Number.isFinite(Date.parse(value.serverTime)) || !Number.isFinite(Date.parse(value.nextCutoffAt))
        || !Array.isArray(value.history?.rows) || !Object.keys(GROUPS).every(key => Array.isArray(value.leaders?.[key]))) throw new Error('Invalid bonus response');
      data = value; render(owner);
    } catch { if (id === serial) unavailable(owner); }
    finally { view.clearTimeout(timeout); }
  }
  const active = () => ['', '#overview', '#bonuses'].includes(view.location.hash) && !document.hidden;
  const route = () => {
    if (historyHash !== view.location.hash) { historyHash = view.location.hash; forgetHistoryOwner(); }
    if (active()) void refresh();
  };
  const changeCategory = () => { forgetHistoryOwner(); pageNumber = 1; rows.replaceChildren(); status.textContent = 'Checking selected bonus history…'; void refresh(); };
  select.addEventListener('change', changeCategory);
  previous.addEventListener('click', () => { forgetHistoryOwner(); pageNumber--; void refresh(); });
  next.addEventListener('click', () => { forgetHistoryOwner(); pageNumber++; void refresh(); });
  page.querySelector('[data-bonus-history-refresh]').addEventListener('click', () => { void refresh(); });
  for (const link of home.querySelectorAll('[data-bonus-category-link]')) link.addEventListener('click', () => {
    forgetHistoryOwner();
    select.value = link.dataset.bonusCategoryLink; pageNumber = 1;
  });
  view.addEventListener('hashchange', route); document.addEventListener('visibilitychange', route);
  const clockTimer = view.setInterval(() => { if (active()) tick(); }, 1000);
  const refreshTimer = view.setInterval(route, 30_000);
  route();
  return () => {
    forgetHistoryOwner();
    ++serial; request?.abort(); view.clearInterval(clockTimer); view.clearInterval(refreshTimer);
    for (const frame of frames.values()) view.cancelAnimationFrame(frame);
    view.removeEventListener('hashchange', route); document.removeEventListener('visibilitychange', route);
  };
}
