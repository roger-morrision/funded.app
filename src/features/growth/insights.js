// Analytics chart of verified payouts per day, a pinned "your rank" row on the
// leaderboard, and a creator panel on the token page for the coin's creator.
import { el, lamports, sol, getJSON, shortWallet } from './format.js';

const SERIES = [
  ['holders', 'Holder & creator SOL', ['automatic-holder', 'automatic-creator', 'v3-creator-wallet'], 'var(--fv-info, #8fb2f0)'],
  ['bonus', 'Daily bonus', ['daily-bonus'], 'var(--fv-accent, #f4a340)'],
  ['other', 'Other payouts', null, 'var(--fv-text-subtle, #77869b)'],
];

export function dailyPayouts(rows, days = 14, now = Date.now()) {
  const end = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const buckets = Array.from({ length: days }, (_, i) => ({ day: end - (days - 1 - i) * 86_400_000, holders: 0n, bonus: 0n, other: 0n }));
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const amount = lamports(row.actualReceivedLamports), at = Number(row.blockTime) * 1000;
    if (amount == null || !Number.isFinite(at) || !row.signature) continue;
    const key = `${row.signature}:${row.to}`; if (seen.has(key)) continue; seen.add(key);
    const bucket = buckets.find(b => at >= b.day && at < b.day + 86_400_000); if (!bucket) continue;
    const series = SERIES.find(([, , sources]) => sources?.includes(row.source))?.[0] || 'other';
    bucket[series] += amount;
  }
  return buckets;
}

function chartSvg(buckets) {
  const width = 720, height = 220, pad = 28, barGap = 6;
  const totals = buckets.map(b => b.holders + b.bonus + b.other);
  const max = totals.reduce((m, v) => (v > m ? v : m), 0n) || 1n;
  const barWidth = (width - pad * 2) / buckets.length - barGap;
  let bars = '';
  buckets.forEach((bucket, i) => {
    let y = height - pad;
    const x = pad + i * (barWidth + barGap);
    for (const [key, label, , color] of SERIES) {
      const h = Number(bucket[key] * 1000n / max) / 1000 * (height - pad * 2);
      if (h <= 0) continue;
      y -= h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"><title>${new Date(bucket.day).toISOString().slice(5, 10)} · ${label}: ${sol(bucket[key])}</title></rect>`;
    }
    if (i % 2 === 0) bars += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle">${new Date(bucket.day).toISOString().slice(5, 10)}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Verified payouts per day, last ${buckets.length} days" class="insights-chart-svg"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" />${bars}</svg>`;
}

export function mountPayoutChart(document = globalThis.document) {
  const page = document.getElementById('analytics-detail');
  if (!page || document.getElementById('insights-payout-chart')) return Boolean(page);
  const card = el(document, 'section', 'insights-chart panel'); card.id = 'insights-payout-chart';
  card.innerHTML = '<header><div><p class="eyebrow">Last 14 days</p><h2>Verified payouts per day</h2></div><ul class="insights-legend"></ul></header><div class="insights-chart-body"><p class="field-help">Loading verified payouts…</p></div>';
  card.querySelector('.insights-legend').innerHTML = SERIES.map(([, label, , color]) => `<li><i style="background:${color}"></i>${label}</li>`).join('');
  const anchor = page.querySelector(':scope > .section-heading');
  if (anchor) anchor.after(card); else page.prepend(card);
  let loaded = false;
  const load = async () => {
    if (loaded || location.hash !== '#analytics-detail') return; loaded = true;
    const history = await getJSON('/api/evidence/payment-history', { timeout: 30000 });
    const body = card.querySelector('.insights-chart-body');
    if (!Array.isArray(history?.verifiedPayouts)) { body.innerHTML = '<p class="field-help">Payout history is unavailable right now.</p>'; loaded = false; return; }
    const buckets = dailyPayouts(history.verifiedPayouts);
    const total = buckets.reduce((sum, b) => sum + b.holders + b.bonus + b.other, 0n);
    body.innerHTML = total === 0n ? '<p class="field-help">No verified payouts in the last 14 days.</p>' : chartSvg(buckets) + `<p class="field-help">${sol(total)} verified in the last 14 days. Hover a bar for details.</p>`;
  };
  void load(); globalThis.addEventListener?.('hashchange', load);
  return true;
}

export function mountCreatorPanel(app, document = globalThis.document) {
  const coin = document.getElementById('coin-page');
  if (!coin || document.getElementById('coin-creator-panel')) return Boolean(coin);
  const panel = el(document, 'section', 'coin-creator-panel panel'); panel.id = 'coin-creator-panel'; panel.hidden = true;
  (coin.querySelector('.coin-main-column') || coin).prepend(panel);
  const clear = () => { panel.hidden = true; panel.replaceChildren(); };
  globalThis.addEventListener?.('funded:reward-identity-change', clear);
  globalThis.addEventListener?.('funded:coin-facts-loading', clear);
  globalThis.addEventListener?.('funded:coin-facts', event => {
    const { mint, launch, error } = event.detail || {};
    const wallet = app.connectedWalletAddress;
    const creator = launch?.creatorWallet || launch?.feePayer;
    panel.hidden = Boolean(error || !wallet || !creator || wallet !== creator || mint !== app.getCoinMintAddress?.());
    if (panel.hidden) return;
    const text = id => document.getElementById(id)?.textContent.trim() || '—';
    panel.innerHTML = `<header><div><p class="eyebrow">Creator view · ${shortWallet(wallet)}</p><h2>Your coin at a glance</h2></div></header>`;
    const stats = el(document, 'dl', 'coin-creator-stats');
    for (const [label, value] of [['Holders', text('coin-holder-count')], ['24h volume', text('coin-strip-volume')], ['Market cap', text('coin-strip-market-cap')], ['24h trades', text('coin-strip-trades')]]) {
      const box = el(document, 'div'); box.append(el(document, 'dt', null, label), el(document, 'dd', null, value)); stats.append(box);
    }
    const links = el(document, 'nav', 'coin-creator-links'); links.setAttribute('aria-label', 'Creator actions');
    for (const [label, href] of [['Claim creator fees', '#payments/creator'], ['AI agents & milestones', '#marketing-agency'], ['Invite creators', '#referrals'], ['My projects', '#my-launches']]) {
      const a = el(document, 'a', 'secondary-button', label); a.href = href; links.append(a);
    }
    panel.append(stats, links);
  });
  return true;
}
