import { readQuickBuyPresets, saveQuickBuyPresets, resetQuickBuyPresets, DEFAULT_QUICK_BUY } from './quick-buy-presets.js';

// Table "Buy" buttons open a small menu of the saved quick-buy amounts. The menu
// is fixed-positioned so a scrolling table cannot clip it; its links are the same
// quick-buy links coin cards use, so choosing one opens the wallet to approve.
export function mountQuickBuyMenus(document = globalThis.document) {
  if (document.documentElement.dataset.quickBuyMenus) return;
  document.documentElement.dataset.quickBuyMenus = 'true';
  let open = null;
  const close = (focus = false) => {
    if (!open) return;
    const { toggle, menu } = open; open = null;
    menu.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (focus) toggle.focus();
  };
  const place = (toggle, menu) => {
    const box = toggle.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.minWidth = `${Math.max(box.width, 140)}px`;
    const below = box.bottom + 6, height = menu.offsetHeight || 140;
    menu.style.top = `${below + height > innerHeight ? Math.max(8, box.top - height - 6) : below}px`;
    menu.style.left = `${Math.min(Math.max(8, box.right - Math.max(box.width, 140)), innerWidth - 160)}px`;
  };
  document.addEventListener('click', event => {
    const toggle = event.target.closest?.('[data-quick-buy-toggle]');
    if (toggle) {
      event.preventDefault();
      const menu = toggle.parentElement.querySelector('[data-quick-buy-menu]');
      if (open?.toggle === toggle) { close(); return; }
      close();
      menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); place(toggle, menu);
      open = { toggle, menu };
      menu.querySelector('a')?.focus();
      return;
    }
    if (open && !open.menu.contains(event.target)) close();
    else if (open && event.target.closest?.('a')) setTimeout(() => close(), 0);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) close(true); });
  for (const name of ['scroll', 'resize']) globalThis.addEventListener(name, () => close(), { passive: true, capture: true });
}

export function quickBuyMenuMarkup(item, escapeHtml, linksMarkup) {
  const label = escapeHtml(item.symbol || 'token');
  return `<span class="quick-buy-menu-host has-buy-presets"><button type="button" class="card-review-buy quick-buy-toggle" data-quick-buy-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Buy ${label}">Buy <span aria-hidden="true">▾</span></button><span class="quick-buy-menu" data-quick-buy-menu role="menu" aria-label="Quick buy ${label}" hidden>${linksMarkup}</span></span>`;
}

// Wallet profile: edit the three quick-buy amounts used across the app.
export function mountQuickBuySettings(document = globalThis.document) {
  const profile = document.getElementById('profile');
  if (!profile || document.getElementById('quick-buy-settings')) return Boolean(profile);
  const form = document.createElement('form');
  form.id = 'quick-buy-settings'; form.className = 'quick-buy-settings panel';
  form.setAttribute('aria-labelledby', 'quick-buy-settings-title');
  const fields = [0, 1, 2].map(index => `<label>Amount ${index + 1}<span class="quick-buy-input"><input name="amount${index}" inputmode="decimal" autocomplete="off" required pattern="\\d+(\\.\\d{1,4})?" aria-describedby="quick-buy-settings-help"><b>SOL</b></span></label>`).join('');
  form.innerHTML = `<h2 id="quick-buy-settings-title">Quick buy</h2><p id="quick-buy-settings-help">The amounts on coin cards and in the Buy menu. Choosing one opens your wallet to approve that buy; nothing is bought without your approval.</p><div class="quick-buy-fields">${fields}</div><div class="quick-buy-actions"><button type="submit" class="primary-button">Save amounts</button><button type="button" class="secondary-button" data-quick-buy-reset>Reset to ${DEFAULT_QUICK_BUY.join(' / ')} SOL</button></div><p class="quick-buy-status" role="status" aria-live="polite"></p>`;
  const status = form.querySelector('.quick-buy-status');
  const fill = values => values.forEach((value, index) => { form.elements[`amount${index}`].value = value; });
  fill(readQuickBuyPresets());
  form.addEventListener('submit', event => {
    event.preventDefault();
    try { fill(saveQuickBuyPresets([0, 1, 2].map(index => form.elements[`amount${index}`].value))); status.textContent = 'Saved. Coin cards and Buy menus now use these amounts.'; }
    catch (error) { status.textContent = error.message; }
  });
  form.querySelector('[data-quick-buy-reset]').addEventListener('click', () => { fill(resetQuickBuyPresets()); status.textContent = 'Reset to the default amounts.'; });
  profile.append(form);
  return true;
}
