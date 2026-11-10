// Public status page (#status): is each service answering, and when did it last work?
// Reads only public endpoints; a failed read shows "Unavailable", never a guess.
import { el, getJSON } from './format.js';

const ago = iso => {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return 'time unavailable';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

export async function readStatus() {
  const [status, indexer, buyback, bonus, analytics] = await Promise.all([
    getJSON('/api/status'), getJSON('/api/indexer/status'), getJSON('/api/buyback/status'),
    getJSON('/api/daily-bonus/dashboard?category=all&page=1'), getJSON('/api/analytics/summary'),
  ]);
  const check = id => status?.checks?.find(row => row.id === id)?.status;
  return [
    ['App & database', check('storage') === 'operational' ? 'ok' : status ? 'down' : 'unknown', status ? `Build ${String(status.build || '').slice(0, 8) || 'unknown'} · checked ${ago(status.observedAt)}` : 'Status unavailable'],
    ['Solana network', check('network') === 'operational' ? 'ok' : check('network') === 'wrong-network' ? 'down' : 'unknown', status ? `Cluster ${status.cluster}` : 'Status unavailable'],
    ['Fee settlement proofs', status?.settlementVerified ? 'ok' : status ? 'degraded' : 'unknown', status?.settlementVerified ? 'All recorded settlements verified' : 'Verification incomplete or unavailable'],
    ['Launch indexer', indexer?.status === 'ready' ? 'ok' : indexer ? 'degraded' : 'unknown', indexer ? `${indexer.indexedLaunches ?? 0} launches · last sync ${ago(indexer.lastIndexedAt)}` : 'Status unavailable'],
    ['Buyback & burn', buyback ? 'ok' : 'unknown', buyback ? 'Status endpoint answering' : 'Status unavailable'],
    ['Daily bonus', bonus?.serverTime ? 'ok' : 'unknown', bonus?.serverTime ? `${bonus.snapshots ?? 0} snapshots recorded · next cutoff ${new Date(bonus.nextCutoffAt).toUTCString().slice(17, 22)} UTC` : 'Status unavailable'],
    ['Analytics & payouts', analytics ? 'ok' : 'unknown', analytics?.freshness ? `Evidence updated ${ago(analytics.freshness)}` : analytics ? 'Answering' : 'Status unavailable'],
  ];
}

export function mountStatusPage(document = globalThis.document) {
  const main = document.getElementById('main-content');
  if (!main || document.getElementById('status')) return Boolean(main);
  const page = el(document, 'section', 'section-block status-page'); page.id = 'status';
  page.setAttribute('aria-labelledby', 'status-title');
  page.innerHTML = '<div class="section-heading"><div><p class="eyebrow">Service status</p><h1 id="status-title">Is everything running?</h1><p>Live checks of the app, the Solana connection and the payout services. Refreshes every minute.</p></div><button type="button" class="secondary-button" data-status-refresh>Refresh</button></div><p class="status-overall" data-status-overall role="status">Checking…</p><ul class="status-list" data-status-list></ul>';
  main.querySelector(':scope > .site-footer')?.before(page) ?? main.append(page);
  const list = page.querySelector('[data-status-list]'), overall = page.querySelector('[data-status-overall]');
  let busy = false;
  async function refresh() {
    if (busy || location.hash !== '#status') return; busy = true;
    const rows = await readStatus(); busy = false;
    const bad = rows.filter(([, state]) => state !== 'ok').length;
    overall.dataset.state = bad === 0 ? 'ok' : rows.some(([, s]) => s === 'down') ? 'down' : 'degraded';
    overall.textContent = bad === 0 ? 'All systems operational' : `${bad} of ${rows.length} checks need attention`;
    list.replaceChildren(...rows.map(([name, state, detail]) => {
      const item = el(document, 'li'); item.dataset.state = state;
      item.append(el(document, 'span', 'status-dot'), el(document, 'strong', null, name), el(document, 'small', null, detail),
        el(document, 'b', null, { ok: 'Operational', degraded: 'Degraded', down: 'Down', unknown: 'Unavailable' }[state]));
      return item;
    }));
  }
  page.querySelector('[data-status-refresh]').addEventListener('click', () => void refresh());
  globalThis.addEventListener?.('hashchange', () => void refresh());
  globalThis.setInterval?.(() => { if (!document.hidden) void refresh(); }, 60_000);
  void refresh();
  return true;
}
