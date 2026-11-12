const KEY = 'funded.review-buy-sol.v1';
export function validReviewAmount(value) {
  return /^\d+(?:\.\d{1,9})?$/.test(String(value)) && Number(value) > 0 && Number(value) <= 100;
}
export function initializeDiscoveryIntent(app) {
  let amount = '0.1';
  try { const saved = localStorage.getItem(KEY); if (validReviewAmount(saved)) amount = saved; } catch { /* Optional preference. */ }
  const updateIntent = event => {
    const link = event.target.closest('[data-review-buy]');
    if (!link) return;
    // Keep ordinary anchor navigation, including open-in-new-tab. No transaction is signed here.
    const selected = validReviewAmount(link.dataset.reviewAmount) ? link.dataset.reviewAmount : amount;
    link.href = `/token/${encodeURIComponent(link.dataset.reviewBuy)}?reviewBuy=${encodeURIComponent(selected)}`;
  };
  for (const name of ['click', 'pointerdown', 'focusin']) document.addEventListener(name, updateIntent, true);
  // Card quick buy: a plain click opens the wallet to approve the buy in place.
  // Ctrl/Cmd/Shift/middle click still opens the token page.
  document.addEventListener('click', event => {
    const link = event.target.closest?.('.has-buy-presets a.card-review-buy[data-review-buy]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const value = validReviewAmount(link.dataset.reviewAmount) ? link.dataset.reviewAmount : null;
    if (!value) return;
    event.preventDefault();
    void import('../trade/quick-buy.js').then(module => module.quickBuy(app, { mint: link.dataset.reviewBuy, amountSol: value,
      symbol: link.dataset.symbol || '', dexId: link.dataset.dex || '', button: link }));
  });
  const explicit = new URL(location.href).searchParams.get('reviewBuy');
  const requested = explicit ?? amount;
  if (validReviewAmount(requested) && app.getCoinMintAddress()) {
    document.querySelector('[data-coin-trade-side="buy"]')?.click();
    const input = document.querySelector('#trade-amount'); input.value = requested;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    app.setTradeStatus('Buy amount selected. Review a fresh quote before approving in your wallet.');
    if (explicit && matchMedia('(max-width:700px)').matches) document.querySelector('.mobile-trade-open')?.click();
    else if (explicit) document.querySelector('#trade-panel')?.scrollIntoView({ block:'center' });
  }
  const buy = document.querySelector('.mobile-trade-open');
  const nav = document.querySelector('.mobile-workspace-nav');
  if (buy && nav) {
    let dockOrigin = null;
    const sell = document.createElement('button'); sell.type = 'button'; sell.className = 'mobile-trade-sell'; sell.textContent = 'Sell';
    const dockBuy = document.createElement('button'); dockBuy.type = 'button'; dockBuy.className = 'mobile-dock-buy'; dockBuy.textContent = 'Buy';
    nav.querySelector('.mobile-trade-actions').append(dockBuy, sell);
    for (const [button, side] of [[dockBuy, 'buy'], [sell, 'sell']]) {
      button.setAttribute('aria-controls', 'trade-panel');
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => {
        dockOrigin = button;
        document.querySelector(`[data-coin-trade-side="${side}"]`)?.click();
        if (buy.getAttribute('aria-expanded') !== 'true') buy.click();
      });
    }
    document.querySelector('.mobile-trade-close')?.addEventListener('click', () => {
      const origin = dockOrigin; dockOrigin = null;
      if (origin?.getClientRects().length) origin.focus();
    });
    window.addEventListener('hashchange', () => { dockOrigin = null; });
  }
}
