// Leaderboard banner: time left until today's Daily bonus closes, the pool
// collected so far for the selected category, and what ranks 1-3 would get
// if it closed now. Reads /api/daily-bonus/dashboard and /api/daily-bonus.
import { formatProofSol, formatProofUsd } from '../proof/proof-totals.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const CATEGORY = { traders: { key: 'traders', label: 'traders', metric: 'trading volume' }, creators: { key: 'creators', label: 'creators', metric: 'creator fees collected' } };
const DEFAULT_PERCENTS = [50, 30, 20];

export function bonusCountdownSummary({ dashboard, bonus, view = 'traders', now = Date.now() } = {}) {
  const cutoffAt = Date.parse(dashboard?.nextCutoffAt || bonus?.nextCutoffAt || '');
  if (!Number.isFinite(cutoffAt)) return null;
  const category = CATEGORY[view] || CATEGORY.traders;
  const raw = Number(dashboard?.pool?.categoryLamports?.[category.key]);
  const poolLamports = Number.isFinite(raw) && raw >= 0 ? raw : null;
  const percents = Array.isArray(bonus?.policy?.rankPercents) && bonus.policy.rankPercents.length ? bonus.policy.rankPercents.map(Number) : DEFAULT_PERCENTS;
  return {
    category,
    cutoffAt,
    remainingMs: Math.max(0, cutoffAt - now),
    poolLamports,
    prizes: percents.slice(0, 3).map((percent, index) => ({ rank: index + 1, percent, lamports: poolLamports == null ? null : Math.floor(poolLamports * percent / 100) })),
  };
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = value => String(value).padStart(2, '0');
  return `${Math.floor(total / 3600)}h ${pad(Math.floor(total % 3600 / 60))}m ${pad(total % 60)}s`;
}

export function bonusCountdownMarkup(summary, { solUsd = null } = {}) {
  if (!summary) return '';
  const pool = summary.poolLamports;
  const usd = formatProofUsd(pool, solUsd);
  // An empty pool shows each rank's share instead of three "0 SOL" rows.
  const prize = item => {
    const share = item.lamports == null || pool === 0;
    return `<li><b>#${item.rank}</b><span>${escape(share ? `${item.percent}%` : formatProofSol(item.lamports))}</span><small>${share ? 'of the pool' : `${escape(item.percent)}% of pool`}</small></li>`;
  };
  return `<div class="bonus-countdown-clock"><p class="eyebrow">Daily bonus · top 3 ${escape(summary.category.label)}</p><strong data-bonus-countdown aria-live="off">${escape(formatCountdown(summary.remainingMs))}</strong><small>left until today's ranking closes (00:00 UTC)</small></div>
<div class="bonus-countdown-pool"><span>Pool so far today</span><strong>${escape(pool == null ? '—' : formatProofSol(pool))}</strong>${usd ? `<em>≈ ${escape(usd)}</em>` : ''}<small>${pool == null ? 'Total appears once today’s fees are checked' : pool === 0 ? 'Grows with every fee collected today' : `Ranked by ${escape(summary.category.metric)}`}</small></div>
<ol class="bonus-countdown-prizes" aria-label="Estimated payout if the ranking closed now">${summary.prizes.map(prize).join('')}</ol>
<a class="text-button" href="#bonuses">Rules and past winners →</a>`;
}

export function mountBonusCountdown(app, document = globalThis.document, window = globalThis.window) {
  let data = null, loadedAt = 0, loading = null;
  const visible = () => Boolean(document.querySelector('#leaderboard')?.getClientRects().length);
  const banner = () => {
    let node = document.querySelector('#bonus-countdown');
    if (node) return node;
    const anchor = document.querySelector('#leaderboard .leaderboard-toolbar');
    if (!anchor) return null;
    node = document.createElement('section');
    node.id = 'bonus-countdown';
    node.className = 'bonus-countdown panel';
    node.setAttribute('aria-label', 'Daily bonus countdown');
    node.hidden = true;
    anchor.after(node);
    return node;
  };
  // The schedule read is fast and enough for the clock; the slower dashboard
  // read fills in the pool when it arrives. A failed read keeps the last value.
  const read = (path, key) => app.apiRequest(path).then(result => {
    if (result?.available) { data = { ...data, [key]: result.data }; render(); }
  }).catch(() => {});
  const load = () => loading ||= Promise.all([read('/api/daily-bonus', 'bonus'), read('/api/daily-bonus/dashboard', 'dashboard')])
    .finally(() => { loadedAt = Date.now(); loading = null; });
  const cutoffOf = () => Date.parse(data?.dashboard?.nextCutoffAt || data?.bonus?.nextCutoffAt || '');
  const render = () => {
    const node = banner();
    if (!node || !data) return;
    const view = app.leaderboardView === 'creators' ? 'creators' : 'traders';
    const summary = bonusCountdownSummary({ ...data, view });
    const markup = bonusCountdownMarkup(summary, { solUsd: app.coinSolUsdPrice });
    if (node.dataset.markup !== markup) { node.innerHTML = markup; node.dataset.markup = markup; }
    node.hidden = !summary;
  };
  // One light timer: does nothing while the leaderboard is off screen, loads on
  // first view, refreshes every minute and right after the daily cutoff.
  let shown = false;
  const tick = async () => {
    if (!visible()) { shown = false; return; }
    const cutoff = cutoffOf();
    if (!loading && (!shown || Date.now() - loadedAt > 60_000 || (Number.isFinite(cutoff) && Date.now() >= cutoff && Date.now() - loadedAt > 5_000))) {
      shown = true;
      render();
      void load();
      return;
    }
    const clock = document.querySelector('#bonus-countdown [data-bonus-countdown]');
    if (clock && Number.isFinite(cutoff)) clock.textContent = formatCountdown(cutoff - Date.now());
  };
  setInterval(() => void tick(), 1000);
  document.addEventListener('click', event => { if (event.target.closest?.('[data-leaderboard-view]')) setTimeout(render, 0); });
  void tick();
}
