import { productEvent } from '../../../product-events.js';
// Device-only markers contain dates and booleans, never wallet identifiers or amounts.
export function initializeRetentionEvents() {
  try {
    const day = new Date().toISOString().slice(0,10), key = 'funded.last-visit-day.v1';
    const prior = localStorage.getItem(key);
    if (/^\d{4}-\d{2}-\d{2}$/.test(prior || '') && prior < day) productEvent('return_visit');
    localStorage.setItem(key, day);
  } catch { /* Storage is optional; do not invent retention. */ }
  window.addEventListener('funded:product-event', event => {
    if (event.detail?.name !== 'trade_confirmed') return;
    try {
      const key = 'funded.first-verified-trade.v1';
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, 'true'); productEvent('first_verified_trade');
    } catch { /* A confirmed trade still succeeds without analytics storage. */ }
  });
}
