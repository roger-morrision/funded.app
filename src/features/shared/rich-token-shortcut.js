// The top bar keeps one primary action (Create a coin) and the wallet button.
// "Buy $RICH" and notifications live in the wallet menu instead of the top bar.
export function mountRichTokenShortcut(mint, document = globalThis.document) {
  const nav = document.querySelector('#wallet-popover nav');
  if (!nav || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || document.getElementById('header-buy-rich')) return;
  const link = document.createElement('a');
  link.id = 'header-buy-rich';
  link.setAttribute('role', 'menuitem');
  link.textContent = 'Buy $RICH';
  link.href = `/token/${encodeURIComponent(mint)}`;
  link.title = 'Open the $RICH token page';
  nav.prepend(link);
}

export function mountWalletMenuNotifications(document = globalThis.document) {
  const nav = document.querySelector('#wallet-popover nav');
  const bell = document.getElementById('notifications-button');
  if (!nav || !bell || document.getElementById('wallet-popover-notifications')) return;
  const item = document.createElement('button');
  item.type = 'button';
  item.id = 'wallet-popover-notifications';
  item.setAttribute('role', 'menuitem');
  item.textContent = 'Notifications';
  // Reuse the existing bell handlers (dialog + activity render) without duplicating them.
  item.addEventListener('click', () => bell.click());
  nav.append(item);
}
