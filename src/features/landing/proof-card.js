// Welcome hero card: live totals of what has been paid out, so the first thing a
// visitor sees is proof rather than an illustration. Two public reads only; no
// RPC, wallet access or app bootstrap. Falls back to a plain link if offline.
import { proofTotals, proofTotalsMarkup } from '../proof/proof-totals.js';

const card = document.querySelector('[data-proof-card]');
const grid = card?.querySelector('[data-proof-grid]');

async function read(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

if (card && grid) {
  const [summary, price] = await Promise.all([read('/api/analytics/summary').catch(() => null), read('/api/market/sol-usd').catch(() => null)]);
  const items = proofTotals(summary);
  if (items) {
    grid.innerHTML = proofTotalsMarkup(items, { solUsd: price?.priceUsd, keys: ['fees', 'holders', 'bonus', 'launches'], hrefPrefix: '/' });
    card.dataset.state = 'ready';
  } else {
    grid.innerHTML = '<p class="proof-card-status">Payment totals are unavailable right now. Every receipt is still listed in the app.</p>';
    card.dataset.state = 'unavailable';
  }
}
