// Platform proof totals: what the fee rules have actually paid out, read from
// /api/analytics/summary. Shared by the Analytics page strip and the welcome
// page card, so both show the same numbers with the same wording.
const LAMPORTS = 1_000_000_000;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const lamports = value => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; };
const count = value => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };

export function formatProofSol(value) {
  if (value == null) return '—';
  const sol = value / LAMPORTS;
  if (sol === 0) return '0 SOL';
  const digits = sol >= 100 ? 0 : sol >= 1 ? 2 : sol >= 0.01 ? 3 : 4;
  const text = sol < 0.0001 ? '<0.0001' : sol.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return `${text} SOL`;
}

export function formatProofUsd(value, solUsd) {
  if (value == null || !(Number(solUsd) > 0)) return '';
  const usd = value / LAMPORTS * Number(solUsd);
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toLocaleString('en-US', { maximumFractionDigits: usd >= 1000 ? 0 : 2, minimumFractionDigits: usd >= 1000 ? 0 : 2 })}`;
}

const plural = (number, word) => `${number.toLocaleString('en-US')} ${word}${number === 1 ? '' : 's'}`;

export function proofTotals(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const exact = summary.exactLamports || {};
  const allocations = summary.homeFeeAllocations || {};
  const holder = summary.rewardPaid?.holder || summary.feePayoutStats?.holder || {};
  const buybacks = allocations.protocolBuybacks;
  return [
    { key: 'fees', label: 'Fees collected', lamports: lamports(exact.collectedLamports ?? summary.collectedLamports), note: `From ${plural(count(summary.collections), 'verified collection')}`, href: '#payments/history' },
    { key: 'holders', label: 'Paid to holders', lamports: lamports(holder.paidLamports), note: `${plural(count(holder.payoutCount), 'payment')} in SOL`, href: '#payments/history' },
    { key: 'referrals', label: 'Referrals paid', lamports: lamports(exact.referralPaidLamports ?? summary.referralPaidLamports), note: plural(count(summary.referralPayoutCount), 'payment'), href: '#referrals' },
    { key: 'bonus', label: 'Daily bonus paid', lamports: lamports(exact.dailyBonusPaidLamports ?? summary.dailyBonusPaidLamports), note: plural(count(summary.dailyBonusPayoutCount), 'winner payment'), href: '#bonuses' },
    { key: 'buyback', label: 'SOL spent buying $FUNDED', lamports: buybacks ? lamports(buybacks.spentLamports) : null, note: buybacks ? `${BigInt(buybacks.burnedBaseUnits).toLocaleString('en-US')} $FUNDED base units burned · ${plural(buybacks.count, 'indexed buyback')}` : 'Verified buyback receipts unavailable', href: '#buybacks' },
    { key: 'launches', label: 'Coins launched', value: count(summary.launches).toLocaleString('en-US'), note: 'Each with its fee rule saved on Solana', href: '#explore' },
  ];
}

export function proofTotalsMarkup(items, { solUsd = null, keys = null, hrefPrefix = '' } = {}) {
  if (!items) return '';
  const shown = keys ? keys.map(key => items.find(item => item.key === key)).filter(Boolean) : items;
  return shown.map(item => {
    const value = item.value ?? formatProofSol(item.lamports);
    const usd = item.value == null ? formatProofUsd(item.lamports, solUsd) : '';
    return `<a class="proof-total" href="${hrefPrefix}${item.href}" data-proof="${item.key}"><span>${escape(item.label)}</span><strong>${escape(value)}</strong>${usd ? `<em>≈ ${escape(usd)}</em>` : ''}<small>${escape(item.note)}</small></a>`;
  }).join('');
}

// Analytics page strip: placed right under the page heading so the first thing
// on the page is what has been paid, not the fee policy.
export function renderProofStrip(app, document = globalThis.document) {
  const section = document?.querySelector('#analytics-detail');
  if (!section) return;
  let strip = section.querySelector('#proof-totals');
  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'proof-totals';
    strip.className = 'proof-totals';
    strip.setAttribute('role', 'region');
    strip.setAttribute('aria-label', 'Paid out so far');
    (section.querySelector('.section-heading') || section.firstElementChild)?.after(strip);
  }
  const items = proofTotals(app.analyticsSummary);
  const markup = items
    ? `<div class="proof-totals-head"><strong>Paid out so far</strong><a href="#payments/history">See every receipt →</a></div><div class="proof-totals-grid">${proofTotalsMarkup(items, { solUsd: app.coinSolUsdPrice })}</div>`
    : '<div class="proof-totals-head"><strong>Paid out so far</strong><small>Checking payment records…</small></div>';
  if (strip.dataset.markup !== markup) { strip.innerHTML = markup; strip.dataset.markup = markup; }
}
