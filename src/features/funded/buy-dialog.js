// Move the existing controls so quote, wallet and receipt safeguards stay shared.
export function initializeFundedBuyDialog(appState) {
  const trigger = document.querySelector('.launch-tier-buy-link');
  const card = document.querySelector('.burn-buy-card');
  if (!trigger || !card || document.querySelector('#funded-buy-dialog')) return;
  const home = document.createComment('Shared FUNDED buy controls');
  card.before(home);
  const dialog = document.createElement('dialog');
  dialog.id = 'funded-buy-dialog';
  dialog.setAttribute('aria-labelledby', 'funded-buy-title');
  card.querySelector('h2').id = 'funded-buy-title';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'text-button funded-buy-close';
  close.textContent = 'Close'; close.setAttribute('aria-label', 'Close buy dialog');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'text-button funded-buy-retry';
  retry.textContent = 'Refresh pool';
  dialog.append(close, retry); document.body.append(dialog);
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', dialog.id);
  const refresh = async () => {
    if (appState.fundedBuyBusy || retry.disabled) return;
    retry.disabled = true;
    try { await appState.refreshFundedBuyRoute(); }
    finally { retry.disabled = false; }
  };
  const dismiss = () => {
    if (appState.fundedBuyBusy) return;
    dialog.close();
  };
  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (dialog.open) return;
    dialog.insertBefore(card, retry);
    dialog.showModal();
    if (!appState.fundedBuyBusy) {
      appState.fundedBuyPreview = null;
      appState.renderFundedBuyControl('Checking the pool. Preview a new quote before approving.');
      void refresh();
    }
  });
  retry.addEventListener('click', () => { void refresh(); });
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => {
    home.after(card);
    if (!appState.fundedBuyBusy) {
      appState.fundedBuyPreview = null;
      appState.renderFundedBuyControl();
    }
    trigger.focus({ preventScroll:true });
  });
}
