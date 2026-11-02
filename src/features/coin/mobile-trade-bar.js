// Phones: keep Buy and Sell one tap away on a token page, like other launchpads.
// The bar only selects a side and brings the existing trade panel into view;
// quoting and signing stay in that panel.
export function mountMobileTradeBar(document = globalThis.document) {
  const panel = document?.querySelector('#trade-panel');
  if (!panel || document.querySelector('.coin-mobile-trade-bar')) return null;
  const bar = document.createElement('div');
  bar.className = 'coin-mobile-trade-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Trade this coin');
  for (const [side, label] of [['buy', 'Buy'], ['sell', 'Sell']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `coin-mobile-trade-${side}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      panel.querySelector(`[data-coin-trade-side="${side}"]`)?.click();
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.querySelector('#trade-amount')?.focus({ preventScroll: true });
    });
    bar.append(button);
  }
  document.body.append(bar);
  return bar;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountMobileTradeBar(), { once: true });
  else mountMobileTradeBar();
}
