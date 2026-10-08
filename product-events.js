export const PRODUCT_EVENTS = new Set(['navigation','explore_view','token_view','launch_details','launch_options','launch_review','launch_completed','launch_failed','boost_open','boost_confirmed','trade_confirmed','rewards_view','share_open']);
export function productEvent(name) {
  if (!PRODUCT_EVENTS.has(name)) return;
  globalThis.dispatchEvent?.(new CustomEvent('funded:product-event', { detail: { name } }));
}
// Export only known counters, never arbitrary local-storage keys or payloads.
export function productCounterExport(rows) {
  const days = {};
  for (const [date, values] of Object.entries(rows || {}).slice(-30)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !values || typeof values !== 'object') continue;
    days[date] = Object.fromEntries(Object.entries(values).filter(([name, count]) => PRODUCT_EVENTS.has(name) && Number.isSafeInteger(count) && count >= 0));
  }
  return { scope:'this-device-only', days };
}
