const KEY = 'funded.review-buy-sol.v1';
export function validReviewAmount(value) {
  return /^\d+(?:\.\d{1,9})?$/.test(String(value)) && Number(value) > 0 && Number(value) <= 100;
}
export function initializeDiscoveryIntent(app) {
  let amount = '0.1';
  try { const saved = localStorage.getItem(KEY); if (validReviewAmount(saved)) amount = saved; } catch { /* Optional preference. */ }
  const inputs = [];
  for (const parent of document.querySelectorAll('.home-launch-toolbar, #explore .explore-control-bar')) {
    let label = parent.querySelector('.review-buy-setting');
    if (!label) {
      label = document.createElement('label'); label.className = 'review-buy-setting';
      const helpId = `review-buy-help-${inputs.length}`;
      label.innerHTML = `<span>Buy amount · SOL</span><input inputmode="decimal" aria-label="Buy amount in SOL for the card Buy button" aria-describedby="${helpId}" maxlength="13"><small id="${helpId}" class="visually-hidden">Prefills the Buy button on each card. Review a fresh quote before signing; changing this amount does not place a trade.</small>`;
      parent.append(label);
    }
    if(parent.closest('#explore')){
      const preferences=document.createElement('details');preferences.id='explore-trade-preferences';preferences.className='task-page-disclosure';
      const summary=document.createElement('summary');summary.textContent='Buy amount';
      label.before(preferences);preferences.append(summary,label);
      label.querySelector('small')?.classList.remove('visually-hidden');
    }
    const input = label.querySelector('input'); input.value = amount; input.disabled = false; inputs.push(input);
    input.addEventListener('change', () => {
      const valid = validReviewAmount(input.value); input.setAttribute('aria-invalid', String(!valid));
      if (!valid) { app.showToast('Use a SOL amount above 0 and at most 100, with up to nine decimals.'); return; }
      amount = input.value; inputs.forEach(other => { other.value = amount; });
      try { localStorage.setItem(KEY, amount); } catch { app.showToast('Amount applies in this tab; browser storage is unavailable.'); }
    });
  }
  const updateIntent = event => {
    const link = event.target.closest('[data-review-buy]');
    if (!link) return;
    // Keep ordinary anchor navigation, including open-in-new-tab. No transaction is signed here.
    link.href = `/token/${encodeURIComponent(link.dataset.reviewBuy)}?reviewBuy=${encodeURIComponent(amount)}`;
  };
  for (const name of ['click', 'pointerdown', 'focusin']) document.addEventListener(name, updateIntent, true);
  const requested = new URL(location.href).searchParams.get('reviewBuy');
  if (validReviewAmount(requested) && app.getCoinMintAddress()) {
    document.querySelector('[data-coin-trade-side="buy"]')?.click();
    const input = document.querySelector('#trade-amount'); input.value = requested;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    app.setTradeStatus('Saved buy amount selected. Review a fresh quote before approving in your wallet.');
    if (matchMedia('(max-width:700px)').matches) document.querySelector('.mobile-trade-open')?.click();
    else document.querySelector('#trade-panel')?.scrollIntoView({ block:'center' });
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
